/**
 * One agent thinking: a call to its text AI with its tools, looping while it uses them.
 * Claude speaks the Anthropic Messages API; Groq and Ollama the OpenAI-style chat API.
 * An agent may have several AIs in order of priority: when one hits a limit or fails, it rests
 * for a while and the call moves on to the next.
 * Keys only travel in the request header to their own provider; nothing here logs them.
 */
import type { TextProvider } from '../src/sim/settings';

export interface Brain {
  provider: TextProvider;
  model: string;
  /** Not needed for Ollama. */
  key?: string;
  /** Ollama's address. */
  baseUrl?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

/** Runs a tool the agent asked for; what it returns goes back to the agent. */
export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<string>;

/** A picture for an AI that sees (base64). */
export interface Picture {
  type: string;
  data: string;
}

/** Whether a model takes pictures: every Claude, and the vision models elsewhere. */
export function sees(b: Brain): boolean {
  if (b.provider === 'anthropic') return true;
  return /llama-4|vision|-vl|vl-|\bvl\b|gemma-?3|pixtral|llava|minicpm-v|moondream|qwen2\.5vl|qwen3-vl|phi-4-multimodal|kimi-k2\.5/i.test(b.model);
}

/** GPT-OSS sometimes leaks its channel markers into a tool's name («usar_accion<|channel|>commentary»). */
const toolName = (raw: unknown) => String(raw ?? '').replace(/<\|.*$/s, '').trim();

export interface Thought {
  text: string;
  tokens: number;
}

/** A failure the office can explain: bad key, limits, the provider down. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 429: how long the provider asked us to wait. */
    readonly retryAfterMs = 0,
    /** 429 on the daily allowance (not the per-minute one): waiting a few seconds won't help. */
    readonly daily = false,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 90_000;
/** Before a call, keep at least this many tokens of the per-minute allowance free. */
const HEADROOM = 3500;
const RETRIES = 4;

/**
 * One queue per provider and key: calls go one after another and wait for the per-minute
 * allowance the provider reports (free plans, e.g. Groq's 8,000 tokens a minute, run out fast).
 */
interface Gate {
  chain: Promise<unknown>;
  remaining: number;
  resetAt: number;
}
const gates = new Map<string, Gate>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "577ms", "7.66s", "1m2.3s", "2h3m" → milliseconds. */
function duration(v: string | null): number {
  if (!v) return 0;
  let ms = 0;
  for (const [, n, unit] of v.matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * (unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000);
  return ms;
}

/** With another AI to fall back on, waiting longer than this for the allowance isn't worth it. */
const IMPATIENT_MS = 3000;

function queued<T>(key: string, patient: boolean, run: (gate: Gate) => Promise<T>): Promise<T> {
  let gate = gates.get(key);
  if (!gate) gates.set(key, (gate = { chain: Promise.resolve(), remaining: Infinity, resetAt: 0 }));
  const g = gate;
  const next = g.chain.then(async () => {
    if (g.remaining < HEADROOM && Date.now() < g.resetAt) {
      const wait = g.resetAt - Date.now();
      if (!patient && wait > IMPATIENT_MS) throw new LlmError(explain(429, ''), 429, wait);
      await sleep(wait + 250);
    }
    return run(g);
  });
  g.chain = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------- priority and rest

/** AIs resting after a limit or a failure, skipped until then. The key stays in here. */
const resting = new Map<string, { brain: Brain; until: number; why: string }>();
const idOf = (b: Brain) => `${b.provider}|${b.model}|${b.key ?? b.baseUrl ?? ''}`;

const restUntil = (b: Brain) => {
  const r = resting.get(idOf(b));
  if (r && r.until <= Date.now()) resting.delete(idOf(b));
  return resting.get(idOf(b))?.until ?? 0;
};

/** Which AIs are resting now, for the panel (no keys). */
export function restingNow(): { provider: TextProvider; model: string; until: number; why: string }[] {
  const out: { provider: TextProvider; model: string; until: number; why: string }[] = [];
  for (const r of [...resting.values()]) {
    if (!restUntil(r.brain)) continue;
    const same = out.find((x) => x.provider === r.brain.provider && x.model === r.brain.model);
    if (!same) out.push({ provider: r.brain.provider, model: r.brain.model, until: r.until, why: r.why });
    else same.until = Math.min(same.until, r.until);
  }
  return out;
}

export const isResting = (b: Brain) => restUntil(b) > Date.now();

/** How long an AI rests after this failure and why; null if another AI wouldn't do better. */
function restFor(e: unknown): { ms: number; why: string } | null {
  if (!(e instanceof LlmError)) return null;
  if (e.status === 429) return e.daily ? { ms: e.retryAfterMs || 3_600_000, why: 'sin cupo diario' } : { ms: Math.max(e.retryAfterMs, 5000), why: 'límite por minuto' };
  if (e.status === 401 || e.status === 403) return { ms: 30 * 60_000, why: 'la clave no vale' };
  if (e.status === 402) return { ms: 60 * 60_000, why: 'sin saldo' };
  if (e.status === 404 || (e.status === 400 && /model/i.test(e.message))) return { ms: 30 * 60_000, why: 'el modelo no está disponible' };
  if (e.status === 0 || e.status >= 500) return { ms: 2 * 60_000, why: 'no responde' };
  return null;
}

/**
 * Thinks with the first AI of the list that isn't resting. If it hits a limit or fails, it
 * rests and the next one takes over (from the start: a half-done tool loop isn't carried over).
 * When every one is resting, fails with how long until the first is back.
 */
export async function think(
  brains: Brain | Brain[],
  system: string,
  prompt: string,
  tools: ToolSpec[],
  run: ToolRunner,
  opts: { maxRounds?: number; maxTokens?: number; pictures?: Picture[] } = {},
): Promise<Thought> {
  const list = Array.isArray(brains) ? brains : [brains];
  const awake = list.filter((b) => !isResting(b));
  let last: unknown = null;
  for (let i = 0; i < awake.length; i++) {
    const brain = awake[i];
    // The last one left may wait out a short per-minute limit; the others hand over at once.
    const patient = i === awake.length - 1;
    try {
      return await once(brain, system, prompt, tools, run, opts, patient);
    } catch (e) {
      const rest = restFor(e);
      if (!rest) throw e;
      resting.set(idOf(brain), { brain, until: Date.now() + rest.ms, why: rest.why });
      last = e;
    }
  }
  throw allResting(list, last);
}

function allResting(list: Brain[], last: unknown): LlmError {
  // With a single AI, its own error says it best.
  if (list.length === 1 && last instanceof LlmError) return last;
  const rests = list.map((b) => resting.get(idOf(b))).filter((r) => !!r);
  const back = Math.max(5000, Math.min(...rests.map((r) => r.until)) - Date.now());
  const mins = Math.max(1, Math.ceil(back / 60_000));
  const daily = rests.every((r) => r.why === 'sin cupo diario');
  return new LlmError(
    `Todas las IA de tu lista están en pausa (${[...new Set(rests.map((r) => r.why))].join(', ')}). La primera en volver lo hará en unos ${mins} min; puedes añadir otra en Ajustes → IA`,
    429,
    back,
    daily || back > 10 * 60_000,
  );
}

function once(brain: Brain, system: string, prompt: string, tools: ToolSpec[], run: ToolRunner, opts: { maxRounds?: number; maxTokens?: number; pictures?: Picture[] }, patient: boolean): Promise<Thought> {
  const rounds = opts.maxRounds ?? 4;
  const maxTokens = opts.maxTokens ?? 1200;
  const pics = opts.pictures ?? [];
  // An AI that can't see is told there were pictures, so it doesn't pretend.
  const said = pics.length && !sees(brain) ? `${prompt}\n\n(Hay ${pics.length === 1 ? 'una imagen adjunta' : `${pics.length} imágenes adjuntas`} que tu IA no puede ver: si te preguntan por ella, dilo y pide que te la describan.)` : prompt;
  const shown = sees(brain) ? pics : [];
  return brain.provider === 'anthropic'
    ? anthropic(brain, system, said, tools, run, rounds, maxTokens, patient, shown)
    : openAiStyle(brain, system, said, tools, run, rounds, maxTokens, patient, shown);
}

async function post(url: string, headers: Record<string, string>, body: { model: string; [k: string]: unknown }, patient: boolean): Promise<any> {
  // Limits are per model: each model of each key has its own queue.
  const key = `${new URL(url).host}|${headers.authorization ?? headers['x-api-key'] ?? ''}|${body.model}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await queued(key, patient, (gate) => postOnce(url, headers, body, gate));
    } catch (e) {
      // Over the per-minute allowance with nobody to hand over to: wait as long as they say, then try again.
      if (!patient || !(e instanceof LlmError) || e.status !== 429 || e.daily || attempt >= RETRIES) throw e;
      await sleep((e.retryAfterMs || 15_000) + 500);
    }
  }
}

async function postOnce(url: string, headers: Record<string, string>, body: { model: string; [k: string]: unknown }, gate: Gate): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new LlmError(`No se pudo contactar con el proveedor (${(e as Error).name === 'TimeoutError' ? 'tardó demasiado' : 'sin conexión'})`, 0);
  }
  // Only when the provider reports it (Ollama doesn't): a missing header isn't "nothing left".
  const header = res.headers.get('x-ratelimit-remaining-tokens') ?? res.headers.get('anthropic-ratelimit-tokens-remaining');
  const left = header === null ? NaN : Number(header);
  if (Number.isFinite(left)) {
    gate.remaining = left;
    gate.resetAt = Date.now() + (duration(res.headers.get('x-ratelimit-reset-tokens')) || 60_000);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON: reported below */
  }
  if (!res.ok) {
    const detail = String(data?.error?.message ?? data?.message ?? text).slice(0, 300);
    // How long to wait: their header, or the "try again in 7.5s" in the message.
    const after = Number(res.headers.get('retry-after'));
    const said = duration(/try again in ([\dhms.]+)/i.exec(detail)?.[1] ?? null);
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : said;
    if (res.status === 429) {
      gate.remaining = 0;
      gate.resetAt = Date.now() + Math.min(wait || 15_000, 120_000);
    }
    // Out of today's allowance for this model: say so plainly, with how long and what to do.
    if (res.status === 429 && /per day|\(TPD\)|\(RPD\)/i.test(detail)) {
      const mins = Math.max(1, Math.ceil(wait / 60_000));
      throw new LlmError(
        `Se ha agotado el cupo diario gratuito de tu proveedor para este modelo. Vuelve a haber en unos ${mins} min; mientras, puedes añadir otra IA a tu lista en Ajustes → IA`,
        429,
        wait,
        true,
      );
    }
    // No money left on the account: each provider says it its own way (402, OpenAI's 429
    // «insufficient_quota», Anthropic's 400 «credit balance is too low»…). One plain meaning.
    if (res.status === 402 || /insufficient_quota|credit balance|out of credits|exceeded your current quota|billing|payment required/i.test(detail)) {
      throw new LlmError('Tu cuenta de IA no tiene saldo: añade crédito en la web del proveedor o pon otra IA en Ajustes → IA', 402, 0);
    }
    throw new LlmError(explain(res.status, detail), res.status, Math.min(wait, 120_000));
  }
  return data;
}

function explain(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'La clave de la IA no es válida o no tiene permiso';
  if (status === 404) return `El modelo no existe o no está disponible: ${detail}`;
  if (status === 429) return 'El proveedor de IA pide esperar (límite de uso alcanzado)';
  if (status >= 500) return 'El proveedor de IA está fallando ahora mismo';
  return `La IA rechazó la petición: ${detail}`;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- Claude

async function anthropic(brain: Brain, system: string, prompt: string, tools: ToolSpec[], run: ToolRunner, rounds: number, maxTokens: number, patient: boolean, pics: Picture[]): Promise<Thought> {
  const first = pics.length ? [...pics.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.type, data: p.data } })), { type: 'text', text: prompt }] : prompt;
  const messages: any[] = [{ role: 'user', content: first }];
  const specs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  let tokens = 0;
  for (let round = 0; ; round++) {
    const last = round >= rounds;
    const data = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': brain.key ?? '', 'anthropic-version': '2023-06-01' },
      { model: brain.model, max_tokens: maxTokens, system, messages, ...(specs.length ? { tools: specs, ...(last ? { tool_choice: { type: 'none' } } : {}) } : {}) },
      patient,
    );
    tokens += (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    const blocks: any[] = data.content ?? [];
    const calls = blocks.filter((b) => b.type === 'tool_use');
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!calls.length || last) return { text, tokens };
    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const c of calls) results.push({ type: 'tool_result', tool_use_id: c.id, content: await run(toolName(c.name), parseArgs(c.input)) });
    messages.push({ role: 'user', content: results });
  }
}

// ---------------------------------------------------------------- Groq / NVIDIA / Ollama

async function openAiStyle(brain: Brain, system: string, prompt: string, tools: ToolSpec[], run: ToolRunner, rounds: number, maxTokens: number, patient: boolean, pics: Picture[]): Promise<Thought> {
  const base =
    brain.provider === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : brain.provider === 'nvidia'
        ? 'https://integrate.api.nvidia.com/v1'
        : `${(brain.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')}/v1`;
  const headers: Record<string, string> = brain.key ? { authorization: `Bearer ${brain.key}` } : {};
  const messages: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: pics.length ? [{ type: 'text', text: prompt }, ...pics.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.type};base64,${p.data}` } }))] : prompt },
  ];
  const specs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  // GPT-OSS reasons before answering: a little is enough for talking, and saves tokens.
  const extra = /gpt-oss/.test(brain.model) ? { reasoning_effort: 'low' } : {};
  let tokens = 0;
  for (let round = 0; ; round++) {
    const last = round >= rounds;
    const body = { model: brain.model, messages, tools: specs, tool_choice: last ? 'none' : 'auto', max_tokens: maxTokens, ...extra };
    let data: any;
    try {
      data = await post(`${base}/chat/completions`, headers, specs.length ? body : { ...body, tools: undefined, tool_choice: undefined }, patient);
    } catch (e) {
      // The model called a tool with bad arguments and the provider refused it: ask again, then without tools.
      if (!(e instanceof LlmError) || e.status !== 400 || !/tool call validation|failed to call a function/i.test(e.message)) throw e;
      try {
        data = await post(`${base}/chat/completions`, headers, body, patient);
      } catch {
        data = await post(`${base}/chat/completions`, headers, { ...body, tool_choice: 'none' }, patient);
      }
    }
    tokens += data.usage?.total_tokens ?? (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
    const msg = data.choices?.[0]?.message ?? {};
    const calls: any[] = msg.tool_calls ?? [];
    const text = String(msg.content ?? '').trim();
    if (!calls.length || last) return { text, tokens };
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
    for (const c of calls) {
      messages.push({ role: 'tool', tool_call_id: c.id, content: await run(toolName(c.function?.name), parseArgs(c.function?.arguments)) });
    }
  }
}
