/**
 * Pictures the agents make, with Cloudflare Workers AI: Flux and Leonardo models, free up to 10,000
 * «neurons» a day (from about 3 to 170 pictures, by quality). Your account id and token stay in the
 * vault and travel only to api.cloudflare.com; every picture is kept like a chat file, in the
 * office's data folder.
 */
import { IMAGE_QUALITY, KEYS, USD_PER_1000_NEURONS, type ImageQuality, type ImageUsage } from '../src/sim/settings';
import type { ChatFile } from '../src/sim/types';
import type { ToolSpec } from './llm';
import { getJson, setJson } from './db';
import { saveFile } from './files';
import { stylePrompt } from './style';
import { getSettings } from './settings';
import { getSecret, redact } from './vault';

const TIMEOUT_MS = 120_000;
const FREE_PER_DAY = 10_000;

export type Shape = 'cuadrada' | 'horizontal' | 'vertical';
const SIZE: Record<Shape, [number, number]> = { cuadrada: [1024, 1024], horizontal: [1344, 768], vertical: [768, 1344] };
/** Leonardo bills by 512 px tile, so its pictures stay within four (4:3 instead of 16:9). */
const PRO_SIZE: Record<Shape, [number, number]> = { cuadrada: [1024, 1024], horizontal: [1024, 768], vertical: [768, 1024] };
const PRO_STEPS = 30;
const sizeFor = (q: ImageQuality, shape: Shape): [number, number] => (q === 'rapida' ? SIZE.cuadrada : q === 'pro' ? PRO_SIZE[shape] : SIZE[shape]);

/** Pictures can be made: Cloudflare is the image provider and both its values are in the vault. */
export function canDraw(): boolean {
  return getSettings().image.provider === 'cloudflare' && !!getSecret(KEYS.cfAccount) && !!getSecret(KEYS.cfToken);
}

const quality = (): (typeof IMAGE_QUALITY)[number] => IMAGE_QUALITY.find((q) => q.id === (getSettings().image.quality ?? 'equilibrada')) ?? IMAGE_QUALITY[1];

/** Roughly what a picture costs of the free allowance, by Cloudflare's published prices. */
function neurons(q: ImageQuality, [w, h]: [number, number]): number {
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  if (q === 'rapida') return tiles * 4.8 + 4 * 9.6;
  if (q === 'equilibrada') return tiles * 26.05;
  if (q === 'pro') return tiles * 636 + PRO_STEPS * 12;
  return 1363.64 + Math.max(0, (w * h) / 1_048_576 - 1) * 181.82;
}

const today = () => new Date().toISOString().slice(0, 10);
type Spent = { day: string; neurons: number; pictures: number };
/** What this app has spent today by its own count (Cloudflare's day starts at 00:00 UTC). */
function spentHere(): Spent {
  const u = getJson<Spent>('images:usage');
  return u?.day === today() ? u : { day: today(), neurons: 0, pictures: 0 };
}

function spendNeurons(n: number): void {
  const u = spentHere();
  setJson('images:usage', { day: u.day, neurons: u.neurons + n, pictures: u.pictures + 1 });
}

/** The most that may go today: the free allowance plus what you allow to pay beyond it. */
const budgetUsd = () => getSettings().image.dailyUsd ?? 0;
const capNeurons = () => FREE_PER_DAY + (budgetUsd() / USD_PER_1000_NEURONS) * 1000;

/** Cloudflare said there's no more today: count it all as spent, whatever our sums said. */
function spentAll(): void {
  const u = spentHere();
  setJson('images:usage', { ...u, neurons: Math.max(u.neurons, capNeurons()) });
  remote = null;
}

/** Neurons of pictures being made right now (the chat and desk work can draw at once). */
let reserved = 0;


/** Cloudflare's own figure for today, read at most every 20 seconds. */
let remote: { at: number; day: string; neurons: number | null; why?: string } | null = null;
let asking: Promise<void> | null = null;
const FRESH_MS = 20_000;

async function askCloudflare(): Promise<void> {
  const account = getSecret(KEYS.cfAccount);
  const token = getSecret(KEYS.cfToken);
  if (!account || !token || !/^[a-f0-9]{32}$/i.test(account)) {
    remote = { at: Date.now(), day: today(), neurons: null };
    return;
  }
  const start = `${today()}T00:00:00Z`;
  const end = new Date(Date.now() + 60_000).toISOString();
  // The account id is checked above (hex only), so it can go in the query as it is.
  const query = `{ viewer { accounts(filter: {accountTag: "${account}"}) { aiInferenceAdaptiveGroups(limit: 1, filter: {datetime_geq: "${start}", datetime_lt: "${end}"}) { sum { totalNeurons } } } } }`;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    const j = (await res.json().catch(() => null)) as {
      data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[] } } | null;
      errors?: { message?: string }[] | null;
    } | null;
    const errors = j?.errors?.map((e) => e.message ?? '').join(' ') ?? '';
    if (!res.ok || errors) {
      const denied = res.status === 401 || res.status === 403 || /auth|permission|not allowed|access/i.test(errors);
      remote = {
        at: Date.now(),
        day: today(),
        neurons: null,
        why: denied ? 'Para ver el saldo real, añade a tu token de Cloudflare el permiso «Account Analytics: Read»' : 'Cloudflare no ha dado tu consumo ahora mismo',
      };
      return;
    }
    const groups = j?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    remote = { at: Date.now(), day: today(), neurons: groups[0]?.sum?.totalNeurons ?? 0 };
  } catch {
    remote = { at: Date.now(), day: today(), neurons: null, why: 'No hay conexión con Cloudflare' };
  }
}

/**
 * Today's free allowance: Cloudflare's figure (everything on your account, also outside this app)
 * when the token may read it, or this app's own sums. Its figures lag a minute or two behind, so
 * the higher of the two counts.
 */
async function usedNow(): Promise<{ used: number; there: number | null }> {
  if (!remote || remote.day !== today() || Date.now() - remote.at > FRESH_MS) {
    asking ??= askCloudflare().finally(() => (asking = null));
    await asking;
  }
  const there = remote?.day === today() ? remote.neurons : null;
  return { used: Math.round(Math.max(spentHere().neurons, there ?? 0)), there };
}

export async function imageUsage(): Promise<ImageUsage> {
  const { used, there } = await usedNow();
  const here = spentHere();
  const cap = capNeurons();
  const left = Math.max(0, cap - used);
  const fits = Object.fromEntries(IMAGE_QUALITY.map((q) => [q.id, Math.floor(left / neurons(q.id, sizeFor(q.id, 'cuadrada')))])) as Record<ImageQuality, number>;
  const tomorrow = new Date(`${today()}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    used,
    free: FREE_PER_DAY,
    cap: Math.round(cap),
    budgetUsd: budgetUsd(),
    spentUsd: Math.round((Math.max(0, used - FREE_PER_DAY) / 1000) * USD_PER_1000_NEURONS * 1000) / 1000,
    pictures: here.pictures,
    fits,
    quality: quality().id,
    resetsAt: tomorrow.toISOString(),
    source: there === null ? 'app' : 'cloudflare',
    ...(there === null && remote?.why ? { why: remote.why } : {}),
    checkedAt: remote?.at ?? Date.now(),
  };
}

/** When the allowance comes back, in this computer's time (00:00 UTC). */
const resetHour = () => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
};

/** Cloudflare's answer, said plainly. */
function explain(status: number, body: string): string {
  if (status === 401 || status === 403 || /authentication|unauthorized|10000/i.test(body)) return 'Cloudflare no acepta el token o el ID de cuenta: revísalos en Ajustes → IA → Imágenes';
  if (status === 429 || /daily free allocation|neurons|4006/i.test(body))
    return budgetUsd() > 0
      ? `Cloudflare no deja pasar del cupo gratis: para pagar lo que lo supera hace falta su plan Workers Paid (5 $ al mes). Si no, vuelve a las ${resetHour()}`
      : `Se ha acabado el cupo gratis de imágenes de hoy en Cloudflare: vuelve a las ${resetHour()}`;
  if (/nsfw|safety|flagged/i.test(body)) return 'Cloudflare ha rechazado esa descripción por su filtro de contenido';
  if (status >= 500) return 'Cloudflare está fallando ahora mismo: prueba en un rato';
  return `Cloudflare no pudo hacer la imagen (${status})`;
}

/** One picture from a description (better in English). Kept as a chat file. */
export async function draw(prompt: string, shape: Shape = 'cuadrada', name = 'imagen'): Promise<ChatFile> {
  const account = getSecret(KEYS.cfAccount);
  const token = getSecret(KEYS.cfToken);
  if (!account || !token) throw new Error('Falta tu cuenta de Cloudflare: ponla en Ajustes → IA → Imágenes');
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('El ID de cuenta de Cloudflare no tiene el formato correcto (32 caracteres hexadecimales)');
  const q = quality();
  const size = sizeFor(q.id, SIZE[shape] ? shape : 'cuadrada');
  const text = prompt.trim().slice(0, 2000);
  if (!text) throw new Error('Falta la descripción de la imagen');
  // Before asking Cloudflare: would this picture go past what you allow today?
  const cost = neurons(q.id, size);
  const { used } = await usedNow();
  if (used + reserved + cost > capNeurons()) {
    const usd = budgetUsd();
    throw new Error(
      usd > 0
        ? `Se ha llegado al gasto máximo de imágenes de hoy (${usd.toFixed(2).replace('.', ',')} $): vuelve a las ${resetHour()} o súbelo en Ajustes → IA → Imágenes`
        : `Se ha acabado el cupo gratis de imágenes de hoy: vuelve a las ${resetHour()} o permite un gasto diario en Ajustes → IA → Imágenes`,
    );
  }
  reserved += cost;
  try {
    return await ask(account, token, q, size, text, name);
  } finally {
    reserved -= cost;
  }
}

async function ask(account: string, token: string, q: (typeof IMAGE_QUALITY)[number], size: [number, number], text: string, name: string): Promise<ChatFile> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${q.model}`;
  let res: Response;
  try {
    if (q.id === 'rapida' || q.id === 'pro') {
      // Flux 1 Schnell (square pictures only) and Leonardo take JSON.
      const input = q.id === 'rapida' ? { prompt: text, steps: 6 } : { prompt: text, width: size[0], height: size[1], num_steps: PRO_STEPS, guidance: 4.5 };
      res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } else {
      // Flux 2 takes a multipart form, even for a prompt alone.
      const form = new FormData();
      form.append('prompt', text);
      form.append('width', String(size[0]));
      form.append('height', String(size[1]));
      res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    }
  } catch (e) {
    throw new Error((e as Error).name === 'TimeoutError' ? 'Cloudflare tardó demasiado en hacer la imagen' : 'No hay conexión con Cloudflare');
  }
  if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) {
    // Some models answer with the picture itself instead of JSON.
    return keep(Buffer.from(await res.arrayBuffer()), q.id, size, name);
  }
  const body = await res.text();
  if (!res.ok) {
    const why = explain(res.status, redact(body));
    if (why.startsWith('Se ha acabado')) spentAll();
    throw new Error(why);
  }
  let image = '';
  try {
    const j = JSON.parse(body) as { result?: { image?: string }; image?: string; success?: boolean; errors?: { message?: string }[] };
    image = j.result?.image ?? j.image ?? '';
    if (!image && j.errors?.length) throw new Error(explain(res.status, redact(JSON.stringify(j.errors))));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Cloudflare')) throw e;
  }
  if (!image) throw new Error('Cloudflare no devolvió ninguna imagen');
  return keep(Buffer.from(image.replace(/^data:[^,]+,/, ''), 'base64'), q.id, size, name);
}

/** A picture that came back: counted against today's allowance and kept as a chat file. */
function keep(bytes: Buffer, q: ImageQuality, size: [number, number], name: string): ChatFile {
  spendNeurons(neurons(q, size));
  remote = null;
  const ext = bytes[0] === 0x89 ? 'png' : bytes[0] === 0x52 ? 'webp' : 'jpg';
  return saveFile(`${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'imagen'}.${ext}`, bytes);
}

export const IMAGE_TOOL: ToolSpec = {
  name: 'generar_imagen',
  description:
    'Genera imágenes con IA (mockups, fotos de producto, ilustraciones) y se las envía al propietario. Describe la imagen en inglés, concreta: objeto, materiales, fondo, luz, encuadre, estilo.',
  parameters: {
    type: 'object',
    properties: {
      descripcion: { type: 'string', description: 'la imagen, en inglés y con detalle' },
      formato: { type: 'string', enum: ['cuadrada', 'horizontal', 'vertical'] },
      cantidad: { type: 'number', description: 'cuántas variantes (1-4)' },
      nombre: { type: 'string', description: 'nombre corto para el archivo, en español' },
      sin_guia: { type: 'boolean', description: 'true solo si el propietario pide expresamente otro estilo distinto del de la oficina' },
    },
    required: ['descripcion'],
  },
};

const GENERIC = new Set(
  'hola buenas puedes podrias podrías sabes quiero querria querría me te nos una uno unas unos un la las el los de del en con para por que qué y o a al genera generar generame genérame generas crea crear creame créame haz hazme hacer haces dibuja dibujar dibujame diseña diseñar diseñame prepara preparar imagen imagenes imágenes foto fotos fotografia fotografía ilustracion ilustración dibujo algo alguna alguno cualquier cosa favor porfa porfavor gracias ahora tu tú si sí no ya mas más otra otro'.split(' '),
);

/**
 * Whether your message asks for a picture and says what it is: «hazme un mockup de taza blanca»
 * does, «¿puedes generar imágenes?» doesn't (that's a question, answered with words).
 */
export function asksForPicture(text: string, followUp = false): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = t.split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1 && !GENERIC.has(w));
  // Right after one they made: a change to it («más oscura», «ahora en azul») is enough.
  if (followUp) return words.length >= 1 && !/^\s*¿?\s*(puedes|podrias|sabes)\b/.test(t);
  if (!/(genera|crea|haz|hacer|hazme|dibuj|disen|prepar|mockup|imagen|foto|ilustr|render|banner|portada|logo)/.test(t)) return false;
  // With a verb that asks for it, saying what is enough («crea 3 imágenes de tazas»).
  const asked = /\b(genera|generame|crea|creame|haz|hazme|dibuja|dibujame|disena|disename|prepara|preparame|quiero|necesito|pasame)\b/.test(t) || /\bgenerar?me\b|\bcrear?me\b/.test(t);
  return words.length >= (asked ? 1 : 2);
}

/** In someone's work, pictures only when the task is about them. */
export const visualTask = (title: string) => /(imag|mockup|foto|disen|ilustr|banner|logo|portada|visual|render|miniatura|creatividad|moodboard|maqueta|bodegon|escenograf)/i.test(title.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

/** The tool: up to four variants of one description. */
export async function drawFor(args: Record<string, unknown>): Promise<{ files: ChatFile[]; note: string; result: string }> {
  // The office's look goes into every picture, unless you asked for another style.
  const style = args.sin_guia === true ? null : stylePrompt();
  const desc = String(args.descripcion ?? '').trim();
  const prompt = style && desc ? `${desc.slice(0, 2000 - style.length - 9)}\n\nStyle: ${style}` : desc;
  const shape = (['cuadrada', 'horizontal', 'vertical'] as const).find((s) => s === args.formato) ?? 'cuadrada';
  const count = Math.max(1, Math.min(4, Math.round(Number(args.cantidad) || 1)));
  const name = String(args.nombre ?? 'imagen');
  const files: ChatFile[] = [];
  let error = '';
  for (let i = 0; i < count; i++) {
    try {
      files.push(await draw(prompt, shape, count > 1 ? `${name} ${i + 1}` : name));
    } catch (e) {
      error = (e as Error).message;
      break;
    }
  }
  if (!files.length) return { files, note: 'no pudo generar la imagen', result: `No salió: ${error}` };
  return {
    files,
    note: `generó ${files.length === 1 ? 'una imagen' : `${files.length} imágenes`}`,
    result: `(Para ti, no para copiar: ${files.length === 1 ? 'la imagen ya está' : `las ${files.length} imágenes ya están`} en el chat del propietario${error ? `; el resto falló: ${error}` : ''}. Contéstale con tus palabras, en una frase, qué has hecho o pregúntale si quiere cambios.)`,
  };
}
