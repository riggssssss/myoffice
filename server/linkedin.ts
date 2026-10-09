/**
 * LinkedIn for you, the honest way: the team writes, you approve, it's published through your
 * connected account (Composio, official API). Your voice (how you write) goes into everything
 * they draft for you; every post goes through the humanizer before it reaches you, with its
 * score on the approval card; and, if you turn it on, a weekly plan: which days, what kind of
 * post, which hook, which angle, drafted on the day and waiting for your yes.
 *
 * Adapted from linkedin-agent-skill by Jake Schincariol (MIT): hooks, post shape, plan and
 * profile rubric, in Spanish. Nothing is posted without approval, and never more than one post
 * a day: automated posting on LinkedIn is what gets accounts restricted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppAction } from '../src/sim/apps';
import { DEFAULT_PLAN, POST_TYPES, VOICE_TEMPLATE, WEEK_DAYS, type LinkedInView, type PlanSettings, type PlanSlot, type PlanWeek, type PostReview, type PostType } from '../src/sim/linkedin';
import { getState, headOf, notify, worker } from '../src/sim/ops';
import type { Worker } from '../src/sim/types';
import { brainOf, overDailyCap, spend, systemFor } from './agents';
import { propose } from './approvals';
import { connectedApps, runAppAction } from './composio';
import { getJson, setJson } from './db';
import { humanize, report } from './humanizer';
import { LlmError, think, type ToolSpec } from './llm';
import { briefText, parseJson } from './meetings';
import { redact } from './vault';

interface Hook {
  id: number;
  name: string;
  template: string;
  example: string;
  for: string;
  trap: string;
}
let hooksCache: Hook[] | null = null;
const hooks = (): Hook[] =>
  (hooksCache ??= (JSON.parse(readFileSync(fileURLToPath(new URL('./data/hooks.es.json', import.meta.url)), 'utf8')) as { hooks: Hook[] }).hooks);
const hookOf = (n: number) => hooks().find((h) => h.id === n) ?? hooks()[0];

let notifier: () => void = () => {};
export const setLinkedInNotifier = (fn: () => void) => (notifier = fn);
const changed = () => notifier();

export const connected = () => connectedApps().includes('linkedin');
export const voice = (): string => getJson<string>('li:voice') ?? '';
export const planSettings = (): PlanSettings => ({ ...DEFAULT_PLAN, ...getJson<Partial<PlanSettings>>('li:plan') });
const week = (): PlanWeek | null => getJson<PlanWeek>('li:week') ?? null;
const saveWeek = (w: PlanWeek) => (setJson('li:week', w), changed());
let busy: string | null = null;

/** Who writes for LinkedIn: social media, copy, marketing… */
export const isSocial = (w: Worker) => w.role === 'marketing' || w.team === 'crecimiento' || /linkedin|redes|social|copy|contenid|community|marca personal|comunicaci/i.test(w.title);

/** Who runs the plan: the one you chose, or whoever fits best (LinkedIn in their post first). */
export function runner(): Worker | undefined {
  const st = getState();
  const chosen = worker(planSettings().who);
  if (chosen) return chosen;
  const by = (re: RegExp, role?: Worker['role']) => st.workers.find((w) => w.enabled && re.test(w.title) && (!role || w.role === role));
  // Marketing first: «Diseño gráfico y redes» makes the pieces, it doesn't run the account.
  return (
    by(/linkedin/i) ?? by(/redes|social|community/i, 'marketing') ?? by(/copy|contenid/i, 'marketing') ?? st.workers.find((w) => w.enabled && w.role === 'marketing') ?? by(/redes|social/i) ?? headOf(st.workers)
  );
}

export function linkedinView(): LinkedInView {
  return { connected: connected(), voice: voice(), plan: planSettings(), week: week(), busy, runner: runner()?.id ?? null };
}

// ---------------------------------------------------------------- your settings

export function setVoice(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 6000) return 'Tu voz cabe en 6.000 caracteres';
  setJson('li:voice', v.trim());
  changed();
  return null;
}

/** Your voice, written from a few of your own posts (better than guessing at the answers). */
export async function draftVoice(posts: unknown): Promise<string> {
  if (typeof posts !== 'string' || posts.trim().length < 200) throw new LlmError('Pega al menos dos o tres posts tuyos', 0);
  const who = runner();
  const brain = who ? brainOf(who) : 'No hay nadie en la oficina';
  if (typeof brain === 'string') throw new LlmError(brain, 0);
  if (overDailyCap()) throw new LlmError('La oficina ha llegado al límite de tokens de hoy', 0);
  const out = await think(
    brain,
    'Analizas cómo escribe una persona a partir de sus posts y lo dejas por escrito para que otros escriban como ella. Concreto y fiel: lo que se ve en sus textos, nada inventado.',
    [
      `Sus posts:\n«««\n${posts.slice(0, 12_000)}\n»»»`,
      '',
      `Rellena esta ficha con lo que se ve en ellos (palabras que usa de verdad, largo de frase, emojis, tuteo, temas y posturas). Lo que no se pueda saber, déjalo vacío. Devuelve solo la ficha, en Markdown:\n${VOICE_TEMPLATE}`,
    ].join('\n'),
    [],
    async () => '',
    { maxRounds: 0, maxTokens: 1400 },
  );
  spend(out.tokens);
  return out.text.replace(/^```(?:markdown)?\s*|```\s*$/g, '').trim().slice(0, 6000);
}

export function setPlan(p: unknown): string | null {
  const b = (p ?? {}) as Partial<PlanSettings>;
  const next = planSettings();
  if (typeof b.on === 'boolean') next.on = b.on;
  if (Number.isInteger(b.perWeek) && b.perWeek! >= 1 && b.perWeek! <= 5) next.perWeek = b.perWeek!;
  if (Array.isArray(b.days)) {
    const days = [...new Set(b.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))];
    if (!days.length) return 'Elige al menos un día';
    next.days = days;
  }
  if (typeof b.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) next.time = b.time;
  if (b.who === null || (typeof b.who === 'string' && worker(b.who))) next.who = b.who ?? null;
  if (typeof b.themes === 'string') next.themes = b.themes.slice(0, 2000);
  setJson('li:plan', next);
  changed();
  return null;
}

/** A new plan for this week (the posts already out stay). */
export function redoPlan(): string | null {
  const w = week();
  if (w) saveWeek({ ...w, week: '' });
  return null;
}

// ---------------------------------------------------------------- the agents' kit

export const LI_TOOLS: Record<'humanize' | 'guide', ToolSpec> = {
  humanize: {
    name: 'humanizar',
    description: 'Quita a un texto la huella de IA (caracteres invisibles, rayas, muletillas) y le pone nota de 0 a 100 de lo humano que suena, con lo que queda por reescribir. Úsalo antes de dar por bueno cualquier texto que se publique en nombre del propietario.',
    parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
  },
  guide: {
    name: 'guia_linkedin',
    description: 'Guía para LinkedIn: ganchos (21 fórmulas con ejemplo), forma de un post, plan semanal, comentar en posts de otros, sacar varios posts de un vídeo o documento, o puntuar un perfil.',
    parameters: { type: 'object', properties: { tema: { type: 'string', enum: ['ganchos', 'post', 'plan', 'comentarios', 'reutilizar', 'perfil'] } }, required: ['tema'] },
  },
};

const POST_SHAPE = `Forma de un post de LinkedIn:
- Línea 1: el gancho, sola. Tiene que aguantar el corte de ~140 caracteres en el móvil.
- Línea 2: lo que paga la línea 1, no preparación para la 3.
- Cuerpo: párrafos de 1-3 líneas con una línea en blanco entre cada uno. El espacio en blanco es el formato.
- El giro: una línea que reencuadra lo anterior.
- Cierre: una pregunta concreta que solo este post podría hacer, o una instrucción. Nunca las dos.
- 900-1.300 caracteres. Una sola idea por post: si hay dos, son dos posts.
- Cifras mejor que adjetivos. Sin enlaces en el cuerpo (LinkedIn los castiga): van en el primer comentario.
- Tres hashtags como mucho, al final. Nada de «¿Qué opinas?» ni «¿Estás de acuerdo?».
- Nada inventado: ni cifras, ni clientes, ni resultados. Si falta un dato, deja {{tu cifra}} y avísalo.
- Antes de darlo por bueno: humanizar, y reescribe lo que marque.`;

const RUBRIC = [
  ['Titular (12)', 'Dice a quién ayuda y qué cambia para ellos, con una prueba; no es el cargo. Usa los 220 caracteres.'],
  ['Inicio del «Acerca de» (10)', 'Las dos primeras líneas (antes de «ver más») nombran el problema del lector. Sin «apasionado por» ni biografía en tercera persona.'],
  ['Cuerpo del «Acerca de» (10)', 'A una persona, de tú: su problema, lo que haces, una cifra como prueba y qué hacer después. Menos de 1.400 caracteres.'],
  ['Destacados (8)', 'Tres: el mejor post, una prueba y cómo contactarte.'],
  ['Banner (6)', 'Una línea de posicionamiento y una forma de contacto. No el degradado por defecto.'],
  ['Foto (6)', 'La cara ocupa el 60 %, ojos visibles, de los dos últimos años, fondo que no distrae.'],
  ['Puesto actual (10)', 'Una línea de alcance y 2-3 resultados con cifras. Las tareas no son resultados.'],
  ['Experiencia (8)', 'Los dos últimos puestos detallados; lo de hace más de diez años, una línea cada uno.'],
  ['Aptitudes (6)', 'Las tres primeras son las tres por las que quieres que te contraten, y validadas.'],
  ['Recomendaciones (8)', 'Tres o más de los dos últimos años, cada una con un resultado concreto.'],
  ['Actividad (10)', 'Has publicado o comentado en los últimos siete días.'],
  ['Contacto (6)', 'URL personalizada, un correo o enlace de reserva que funcione y el mismo nombre que en otras redes.'],
];

export function guide(topic: string): string {
  switch (topic) {
    case 'ganchos':
      return `Ganchos (elige tres que encajen con la idea y quédate con el más concreto):\n${hooks()
        .map((h) => `#${h.id} ${h.name}: ${h.template}\n   Ej.: ${h.example}\n   Para: ${h.for} Cuidado: ${h.trap}`)
        .join('\n')}`;
    case 'post':
      return POST_SHAPE;
    case 'plan':
      return `Plan semanal: cuatro posts a la semana rinden más que siete; el quinto suele ser el flojo. Mezcla, nunca dos del mismo tipo seguidos:\n${Object.values(POST_TYPES)
        .map((t) => `- ${t.label}: ${t.job}`)
        .join('\n')}\nCada hueco: un ángulo concreto sacado de lo que pasó de verdad («IA» no es un plan; «la propuesta que perdimos por un borrador con rayas de IA» es un post) y el número de gancho. Para un público profesional, de martes a jueves de 7:30 a 9:30. Pero la hora importa mucho menos que la primera línea. Interactuar: 20 minutos al día, antes de publicar, en posts de 5 cuentas con el público que quieres, 3 de tu nivel y 2 posibles clientes (nunca vender en un comentario).`;
    case 'comentarios':
      return 'Comentar en posts de otros: aporta algo que el post no dice (un dato, una experiencia, un matiz, una pregunta concreta), en 2-4 líneas. Nunca «¡Gran post!», nunca vender. Mejor antes de que tenga 20 comentarios. La API no deja leer posts ajenos: el propietario te pega el post y lo publica él.';
    case 'reutilizar':
      return 'Sacar posts de un vídeo, artículo o documento: no resumas, extrae lo que se sostiene solo (afirmaciones, cifras, historias, mecanismos, errores, frases citables). Di cuántos de cada encontraste; con menos de cuatro, es flojo y dilo. Cada uno es un post que se entiende sin haber visto el original, con un gancho distinto. Orden: la afirmación más fuerte primero, la historia a mitad de semana, el mecanismo al final. Escríbelos de uno en uno.';
    case 'perfil':
      return `Puntuar un perfil sobre 100 (el propietario te pega su titular, «Acerca de» y experiencia: la API no los da). Sé honesto: los perfiles suelen sacar 30-45 la primera vez. Después reescribe por orden de lo que más puntos recupera:\n${RUBRIC.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
    default:
      return 'Temas: ganchos, post, plan, comentarios, reutilizar, perfil.';
  }
}

export function useLiTool(name: string, args: Record<string, unknown>): { result: string; note: string } {
  if (name === 'humanizar') {
    const text = typeof args.texto === 'string' ? args.texto.slice(0, 8000) : '';
    if (!text.trim()) return { note: 'quiso humanizar un texto vacío', result: 'Pásame el texto.' };
    const h = humanize(text);
    return { note: `humanizó un texto (${h.before.score} → ${h.after.score}/100)`, result: report(h) };
  }
  return { note: 'miró la guía de LinkedIn', result: guide(String(args.tema ?? '')) };
}

/** Your voice, for whoever writes things that go out in your name. */
export function voiceFor(w: Worker): string {
  const v = voice();
  if (!v || !isSocial(w)) return '';
  return `Voz del propietario (cuando escribes algo que se publica en su nombre, escribe como él; humanizar antes de darlo por bueno):\n${v.slice(0, 2500)}`;
}

// ---------------------------------------------------------------- every post, checked

const TEXT_KEYS = ['commentary', 'text', 'content', 'body', 'message', 'post', 'share_commentary', 'shareCommentary'];
const bounced = new Map<string, number>();

const today = () => new Date().toDateString();
const actions = () => getJson<AppAction[]>('apps:actions') ?? [];
const isPostTool = (app: string, tool: string) => app === 'linkedin' && /POST|SHARE/.test(tool) && !/DELETE|COMMENT|REACTION|LIKE/.test(tool);

/**
 * A post about to go to LinkedIn: one a day at most; cleaned by the humanizer (in place); sent
 * back once to whoever wrote it if it still sounds machine-made; and its review for your card.
 */
export function checkPost(me: Worker, app: string, tool: string, data: Record<string, unknown>): { refuse?: string; review?: PostReview } {
  if (!isPostTool(app, tool)) return {};
  const key = TEXT_KEYS.find((k) => typeof data[k] === 'string' && (data[k] as string).trim());
  if (!key) return {};
  if (actions().some((a) => a.app === 'linkedin' && isPostTool(a.app, a.tool) && (a.status === 'done' || a.status === 'open') && new Date(a.at).toDateString() === today())) {
    return { refuse: 'Ya hay un post de LinkedIn hoy (publicado o esperando su aprobación). Uno al día como mucho: más parece automatizado y LinkedIn lo castiga. Déjalo para mañana.' };
  }
  const h = humanize(data[key] as string);
  data[key] = h.text;
  // Figures that don't come from anything you've said: made up, in your name.
  const loose = unbacked(h.text);
  const last = bounced.get(me.id) ?? 0;
  if ((h.after.verdict === 'suena a IA' || loose.length) && Date.now() - last > 30 * 60_000) {
    bounced.set(me.id, Date.now());
    return {
      refuse: [
        loose.length ? `Cifras que no salen de nada que sepas del propietario (inventadas en su nombre): ${loose.join(', ')}. Cámbialas por {{tu cifra}} o quítalas.` : '',
        h.after.verdict === 'suena a IA' ? `Aún suena a IA (${h.after.score}/100): reescríbelo.` : '',
        'Vuelve a intentarlo después.',
        report(h),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
  const flags = [...(loose.length ? [`Cifras sin respaldo: ${loose.join(', ')}`] : []), ...h.flags.map((f) => f.name)].slice(0, 5);
  return { review: { score: h.after.score, verdict: h.after.verdict, weakest: h.after.weakest, flags } };
}

/** Numbers in a post that appear nowhere in your voice, your themes or the dossier. */
function unbacked(text: string): string[] {
  const known = `${voice()} ${planSettings().themes} ${briefText()}`.replace(/[.\s]/g, '');
  const nums = text.match(/\d[\d.,]*\s?(?:%|k|h|€|\$|mil|millones)?/gi) ?? [];
  return [...new Set(nums.map((n) => n.trim()))].filter((n) => {
    const digits = n.match(/\d[\d.,]*/)![0].replace(/[.,]/g, '');
    // Small counts read as wording («3 cosas», «2 veces»), not claims.
    return Number(digits) > 10 && !known.replace(/,/g, '').includes(digits);
  });
}

// ---------------------------------------------------------------- the weekly plan

/** ISO week, e.g. 2026-W41. */
function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const n = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(n).padStart(2, '0')}`;
}

/** The moments left this week on your days, at your time, spread out, as many as you want a week. */
function moments(p: PlanSettings, now = new Date()): number[] {
  const [h, m] = p.time.split(':').map(Number);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (p.days.includes(d.getDay()) && d.getTime() > now.getTime() + 20 * 60_000) out.push(d.getTime());
  }
  // Fewer posts than days: every other one, not the first ones in a row.
  if (out.length <= p.perWeek) return out;
  const step = out.length / p.perWeek;
  return Array.from({ length: p.perWeek }, (_, i) => out[Math.floor(i * step)]);
}

const dayName = (at: number) => WEEK_DAYS.find((d) => d.n === new Date(at).getDay())!.name;
const clock = (at: number) => new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const history = () => getJson<{ at: number; angle: string; hook: number; type: PostType }[]>('li:history') ?? [];

async function makePlan(who: Worker, when: number[]): Promise<void> {
  const brain = brainOf(who);
  if (typeof brain === 'string') throw new LlmError(brain, 0);
  const p = planSettings();
  const past = history().slice(-12);
  const out = await think(
    brain,
    systemFor(who, 'owner'),
    [
      'Planificas los posts de LinkedIn del propietario para esta semana.',
      voice() ? `Su voz:\n${voice().slice(0, 2500)}` : 'Aún no ha escrito su voz: tira del dossier.',
      p.themes ? `Temas por los que quiere que le conozcan y lo que ha pasado esta semana:\n${p.themes}` : '',
      briefText() ? `Dossier del producto:\n${briefText().slice(0, 2500)}` : '',
      past.length ? `Últimos posts (no repitas ángulo ni gancho seguido):\n${past.map((x) => `- #${x.hook} ${x.type}: ${x.angle}`).join('\n')}` : '',
      '',
      guide('plan'),
      '',
      `Huecos de esta semana (uno por post, en este orden): ${when.map((t) => `${dayName(t)} ${clock(t)}`).join('; ')}.`,
      `Ganchos: ${hooks().map((h) => `#${h.id} ${h.name}`).join(', ')}.`,
      'Para cada hueco: tipo (prueba, opinion, ensena, historia, oferta), número de gancho y un ángulo concreto en una frase, sacado de lo que de verdad sabes del propietario y su producto. Nada inventado: ninguna cifra que no esté en su voz, sus temas o el dossier (si hace falta una, escribe {{tu cifra}}); si no sabes qué pasó esta semana, ángulos de lo que dice el dossier.',
      'interactuar: 5-8 tipos de cuentas concretos para su público (p. ej. «diseñadores freelance que enseñan su proceso en Figma»), o las personas que él haya nombrado. Nada de nombres de relleno ni «Cuenta X».',
      'Responde SOLO JSON: {"posts":[{"tipo":"prueba","gancho":17,"angulo":"…"}],"interactuar":["…"],"nota":"una frase para el propietario"}',
    ]
      .filter(Boolean)
      .join('\n'),
    [],
    async () => '',
    { maxRounds: 0, maxTokens: 1200 },
  );
  spend(out.tokens);
  const j = parseJson(out.text);
  const posts = Array.isArray(j?.posts) ? (j!.posts as Record<string, unknown>[]) : [];
  if (!posts.length) throw new LlmError('La IA no devolvió un plan válido', 0);
  const types = Object.keys(POST_TYPES) as PostType[];
  const slots: PlanSlot[] = when.map((at, i) => {
    const x = posts[i] ?? posts[posts.length - 1];
    const hook = Number(x.gancho);
    return {
      id: `s${at.toString(36)}`,
      at,
      type: types.includes(x.tipo as PostType) ? (x.tipo as PostType) : types[i % types.length],
      hook: hook >= 1 && hook <= 21 ? hook : 17,
      // A figure the AI made up becomes a gap for you to fill.
      angle: unbacked(String(x.angulo ?? '')).reduce((a, n) => a.split(n).join('{{tu cifra}}'), String(x.angulo ?? '').trim().slice(0, 240)) || 'Un ángulo del dossier',
      status: 'planeado',
    };
  });
  const engage = (Array.isArray(j?.interactuar) ? (j!.interactuar as unknown[]) : [])
    .map((x) => String(x).trim().slice(0, 140))
    // Placeholders («Cuenta de diseño de X», «Mentor B») are no use to anyone.
    .filter((x) => x && !/\b(?:[A-Z]|X|Y|Z)$/.test(x) && !/\bde (?:X|Y|Z)\b/.test(x))
    .slice(0, 8);
  const plan: PlanWeek = { week: weekKey(), at: Date.now(), by: who.id, slots, engage, note: String(j?.nota ?? '').slice(0, 300) };
  saveWeek(plan);
  // Said in their chat with you, like anything else they'd tell you.
  const chat = (who.chat ??= { lines: [], pending: false, thinking: null });
  chat.lines.push({
    at: Date.now(),
    speaker: who.id,
    text: [
      '**Plan de LinkedIn de esta semana**',
      '',
      ...slots.map((s) => `- **${dayName(s.at)} ${clock(s.at)}** · ${POST_TYPES[s.type].label} · gancho #${s.hook} (${hookOf(s.hook).name}): ${s.angle}`),
      engage.length ? `\n**Para interactuar** (20 minutos al día, antes de publicar):\n${engage.map((e) => `- ${e}`).join('\n')}` : '',
      '',
      `Cada post lo escribo el mismo día y te llega a «Para ti» para que lo apruebes.${plan.note ? ` ${plan.note}` : ''}`,
    ].join('\n'),
    tools: [],
  });
  if (chat.lines.length > 40) chat.lines.splice(0, chat.lines.length - 40);
  chat.unread = (chat.unread ?? 0) + 1;
  notify('change');
}

let retryAt = 0;

/** Your LinkedIn member URN (urn:li:person:…), read once from your account and kept here. */
async function author(): Promise<string> {
  const kept = getJson<string>('li:author');
  if (kept) return kept;
  const out = await runAppAction('LINKEDIN_GET_MY_INFO', {});
  const id = out.match(/urn:li:person:([A-Za-z0-9_-]+)/)?.[1] ?? out.match(/"id"\s*:\s*"([A-Za-z0-9_-]{4,})"/)?.[1];
  if (!id) throw new LlmError('LinkedIn no ha dicho quién eres: vuelve a conectar la cuenta en Ajustes → Conectores', 0);
  setJson('li:author', `urn:li:person:${id}`);
  return `urn:li:person:${id}`;
}

/**
 * Today's post: the AI writes only the text (that's what it's good at); the office does the rest
 * the same way every time: humanizer, made-up figures turned into gaps for you, one rewrite if it
 * still sounds machine-made, and the post to «Para ti» to edit and approve.
 */
async function writePost(who: Worker, w: PlanWeek, slot: PlanSlot): Promise<void> {
  const brain = brainOf(who);
  if (typeof brain === 'string') throw new LlmError(brain, 0);
  const h = hookOf(slot.hook);
  slot.status = 'escribiendo';
  saveWeek(w);
  if (actions().some((a) => a.app === 'linkedin' && isPostTool(a.app, a.tool) && (a.status === 'done' || a.status === 'open') && new Date(a.at).toDateString() === today())) {
    Object.assign(slot, { status: 'descartado', note: 'Ya había un post hoy: uno al día como mucho' });
    return saveWeek(w);
  }
  const ask = (extra: string) =>
    think(
      brain,
      systemFor(who, 'owner'),
      [
        `Escribe el post de LinkedIn de hoy (${dayName(slot.at)}) del propietario, en primera persona, como él.`,
        `Tipo: ${POST_TYPES[slot.type].label} (${POST_TYPES[slot.type].job}).`,
        `Ángulo: ${slot.angle}`,
        `Gancho #${h.id} ${h.name}: ${h.template}\nEjemplo: ${h.example}\nCuidado: ${h.trap}`,
        voice() ? `Su voz:\n${voice().slice(0, 2500)}` : '',
        planSettings().themes ? `Sus temas y lo que ha pasado:\n${planSettings().themes}` : '',
        '',
        POST_SHAPE,
        'Ninguna cifra, fecha ni resultado que no esté en su voz, sus temas o el dossier: donde haga falta uno, escribe {{tu cifra}} (él lo rellena antes de aprobar).',
        extra,
        'Responde SOLO con el texto del post, tal como se publicará: sin título, sin «Gancho:», sin comillas ni comentarios.',
      ]
        .filter(Boolean)
        .join('\n'),
      [],
      async () => '',
      { maxRounds: 0, maxTokens: 1200 },
    );
  const clean = (raw: string) =>
    raw
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/^```\w*\s*|```\s*$/g, '')
      .replace(/^\s*(?:gancho|post|texto)\s*:\s*/i, '')
      .trim()
      .replace(/^["«]|["»]$/g, '')
      .trim();
  // Figures the AI came up with become gaps for you to fill.
  const honest = (t: string) => unbacked(t).reduce((acc, n) => acc.split(n).join('{{tu cifra}}'), t);
  let out = await ask('');
  spend(out.tokens);
  let post = humanize(honest(clean(out.text)));
  if (post.after.verdict === 'suena a IA' && post.text.length > 80) {
    out = await ask(`Tu primer borrador sonaba a IA (${post.after.score}/100). Reescríbelo arreglando esto:\n${post.flags.map((f) => `- ${f.name}: ${f.fix}`).join('\n')}\nBorrador:\n${post.text}`);
    spend(out.tokens);
    const again = humanize(honest(clean(out.text)));
    if (again.after.score >= post.after.score) post = again;
  }
  if (post.text.length < 80) throw new LlmError('La IA no devolvió un post', 0);
  const gaps = post.text.match(/\{\{[^}]+\}\}/g)?.length ?? 0;
  const review: PostReview = {
    score: post.after.score,
    verdict: post.after.verdict,
    weakest: post.after.weakest,
    flags: [...(gaps ? [`Rellena ${gaps === 1 ? 'el hueco {{…}}' : `los ${gaps} huecos {{…}}`} antes de aprobar`] : []), ...post.flags.map((f) => f.name)].slice(0, 5),
    for: slot.at,
  };
  const a = propose(
    who,
    'composio',
    'linkedin',
    'LinkedIn',
    'LINKEDIN_CREATE_LINKED_IN_POST',
    { author: await author(), commentary: post.text, visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' },
    `Post del plan (${POST_TYPES[slot.type].label.toLowerCase()}): ${slot.angle}`.slice(0, 300),
    review,
  );
  const now = week();
  const s = now?.slots.find((x) => x.id === slot.id);
  if (now && s) {
    Object.assign(s, { status: 'esperando', actionId: a.id, score: review.score });
    saveWeek(now);
  }
}

/** Every minute: the plan, the post due, and how the ones waiting for you went. */
export async function tickLinkedIn(): Promise<void> {
  const p = planSettings();
  const w = week();
  // Follow the posts waiting for your yes.
  if (w) {
    let moved = false;
    const all = actions();
    for (const s of w.slots) {
      if (s.status !== 'esperando' || !s.actionId) continue;
      const a = all.find((x) => x.id === s.actionId);
      const next = a?.status === 'done' ? 'publicado' : a?.status === 'rejected' ? 'descartado' : a?.status === 'failed' ? 'fallo' : null;
      if (!next) continue;
      s.status = next;
      if (next === 'publicado') setJson('li:history', [...history(), { at: Date.now(), angle: s.angle, hook: s.hook, type: s.type }].slice(-30));
      moved = true;
    }
    // Past its moment by hours with the office closed: let it go.
    for (const s of w.slots) {
      if (s.status === 'planeado' && Date.now() > s.at + 6 * 3600_000) Object.assign(s, { status: 'descartado', note: 'Se pasó la hora con la oficina cerrada' }), (moved = true);
    }
    if (moved) saveWeek(w);
  }
  const st = getState();
  if (!p.on || busy || !connected() || !st.working || overDailyCap() || Date.now() < retryAt) return;
  const who = runner();
  if (!who?.enabled) return;
  try {
    if (!w || w.week !== weekKey()) {
      const when = moments(p);
      if (!when.length) return;
      busy = 'Preparando el plan de la semana';
      changed();
      await makePlan(who, when);
      return;
    }
    const due = w.slots.find((s) => s.status === 'planeado' && Date.now() >= s.at - 45 * 60_000);
    if (!due) return;
    busy = `Escribiendo el post del ${dayName(due.at)}`;
    changed();
    await writePost(who, w, due);
  } catch (e) {
    console.error(`[linkedin] ${redact(e instanceof Error ? e.message : String(e))}`);
    // Something failed (the AI resting, a limit): try again in a while, the post back in its place.
    retryAt = Date.now() + 15 * 60_000;
    const now = week();
    const s = now?.slots.find((x) => x.status === 'escribiendo');
    if (now && s) {
      // One more go later; after that, it's left for you to see why.
      const tries = (s.tries ?? 0) + 1;
      Object.assign(s, tries < 2 ? { status: 'planeado', tries } : { status: 'fallo', tries, note: redact(e instanceof Error ? e.message : 'No salió').slice(0, 200) });
      saveWeek(now);
    }
  } finally {
    if (busy) {
      busy = null;
      changed();
    }
  }
}

export function startLinkedIn(): () => void {
  const timer = setInterval(() => void tickLinkedIn(), 60_000);
  return () => clearInterval(timer);
}
