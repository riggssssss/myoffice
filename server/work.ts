/**
 * Real work at the desk: every few minutes, whoever has a task in progress puts in a stretch
 * on it with their AI and tools, leaves what came out on the task (a draft, findings, a plan)
 * and reports how far it has got. Missing something only you know, they pause and ask.
 */
import { appTools } from './composio';
import { getState, notify, ongoingOf, task } from '../src/sim/ops';
import { ROLES } from '../src/sim/seed';
import type { ChatLine, Task, ToolUse, Worker } from '../src/sim/types';
import { brainOf, spend, systemFor, terse, toolLabel, tidy, toolsFor, useTool, waitForProvider } from './agents';
import { LlmError, think } from './llm';
import { getSettings } from './settings';
import { DEFAULT_WORK_PER_HOUR } from '../src/sim/settings';
import { redact } from './vault';

/** Minutes between stretches of work for one person. */
const EVERY_MS: [number, number] = [4 * 60_000, 8 * 60_000];
/** Stretches going on at once across the office. */
const AT_ONCE = 2;
const NOTES = 20;

const nextAt = new Map<string, number>();
const busy = new Set<string>();
/** When each stretch of the last hour started, office-wide (the team's pace). */
const started: number[] = [];
const lastStretch = new Map<string, number>();

export function workTick(publish: () => void): void {
  const st = getState();
  if (!st.working || !st.brief.kickedOff || st.health.crisis) return;
  const now = Date.now();
  while (started.length && started[0] < now - 3_600_000) started.shift();
  const perHour = getSettings().ai.workPerHour ?? DEFAULT_WORK_PER_HOUR;
  const due: { w: Worker; t: Task }[] = [];
  for (const w of st.workers) {
    if (busy.has(w.id) || w.activity !== 'working' || !w.enabled) continue;
    const t = nextJob(w);
    if (!t) continue;
    // A first stretch soon after they sit down, then every few minutes.
    if (!nextAt.has(w.id)) nextAt.set(w.id, now + 30_000 + Math.random() * 60_000);
    if (now < nextAt.get(w.id)!) continue;
    due.push({ w, t });
  }
  // Fair turns: whoever has gone longest without a stretch goes first, not whoever is first on the list.
  due.sort((a, b) => (lastStretch.get(a.w.id) ?? 0) - (lastStretch.get(b.w.id) ?? 0));
  let going = busy.size;
  for (const { w, t } of due) {
    if (going >= AT_ONCE) return;
    if (perHour > 0 && started.length >= perHour) return;
    going++;
    started.push(now);
    lastStretch.set(w.id, now);
    // Not again until this one is over (it may first stop to ask you something).
    nextAt.set(w.id, now + EVERY_MS[0]);
    void stretch(w, t.id, publish);
  }
}

/**
 * What they put this stretch into: their task with an end and their ongoing jobs take turns,
 * whichever has gone longest without anything new.
 */
function nextJob(w: Worker): Task | null {
  const current = task(w.taskId);
  const jobs = [...(current?.status === 'doing' ? [current] : []), ...ongoingOf(w)];
  const lastAt = (t: Task) => t.notes[t.notes.length - 1]?.at ?? 0;
  return jobs.sort((a, b) => lastAt(a) - lastAt(b))[0] ?? null;
}

/** Work that has to happen out in the world (publishing, uploading, sending…). */
const OUTSIDE = /\b(public|sub(ir|ida)|post(ear|eo)|envi(ar|o)|lanz(ar|amiento)|desplegar|programar (posts|publicaciones)|newsletter|redes sociales|instagram|pinterest|linkedin|tiktok|youtube)/i;

/**
 * Before working on something that has to reach the world: with no connector to do it and no
 * word from you on how, they stop and ask rather than pretend. Returns true if they asked.
 */
async function askFirst(w: Worker, t: Task): Promise<boolean> {
  const st = getState();
  if (!OUTSIDE.test(t.title)) return false;
  // You've already told them something about it (answered or pending): they work with that.
  if (st.questions.some((q) => q.taskId === t.id || (q.workerId === w.id && q.answer === null))) return false;
  if (t.notes.some((n) => n.tools.some((u) => u.name === 'pedir_ayuda'))) return false;
  const r = await useTool(w, null, 'pedir_ayuda', {
    que_necesitas: `Para «${t.title}» necesito saber dónde y cómo se publica (qué web o red, quién sube los archivos) y una herramienta o acceso para hacerlo: ahora no tengo ninguno. Mientras, puedo prepararlo todo para que lo publiques tú.`,
    tipo: 'conector',
    tarea_id: t.id,
  });
  t.notes.push({ at: Date.now(), by: w.id, text: 'Paro y pregunto: no tengo forma de publicar ni sé dónde ni cómo se hace.', tools: [{ name: 'pedir_ayuda', note: r.note }] });
  notify('change');
  return true;
}

async function stretch(w: Worker, taskId: string, publish: () => void): Promise<void> {
  const t = task(taskId);
  const brain = brainOf(w);
  if (!t || typeof brain === 'string') return;
  if (await askFirst(w, t)) {
    nextAt.set(w.id, Date.now() + EVERY_MS[1]);
    publish();
    return;
  }
  busy.add(w.id);
  w.busyWith = `trabajando en «${t.title}»`;
  // What you see if you open their chat meanwhile: the task, each step, and the one going on.
  const startedAt = Date.now();
  w.deskWork = { taskId: t.id, title: t.title, startedAt, steps: [], doing: 'Pensando por dónde seguir' };
  notify('change');
  publish();
  const used: ToolUse[] = [];
  const before = t.notes.slice(-3);
  const prompt = [
    t.ongoing
      ? `En tu mesa, con tu trabajo continuo (sin final; sigue hasta que el propietario lo pare): «${t.title}» (${ROLES[t.role].label}).`
      : `En tu mesa, con tu tarea: «${t.title}» (${ROLES[t.role].label}, ${t.estimate} h estimadas, vas al ${t.progress} %).`,
    before.length ? `${t.ongoing ? 'Últimas entregas' : 'Hecho hasta ahora'}:\n${before.map((n) => `- ${n.text}`).join('\n')}` : 'Sin empezar.',
    '',
    t.ongoing
      ? 'Haz la siguiente entrega de este trabajo, como una hora real: la pieza o revisión que toca ahora (el post de esta vez, la vigilancia de hoy…). Distinta de las anteriores, nada de repetir.'
      : 'Haz un avance real, como una hora de trabajo: el siguiente paso de verdad (borrador, análisis, propuesta, decisiones…). Nada de planes vagos ni repetir lo hecho.',
    'Antes de nada: ¿puedes dar el siguiente paso con tus herramientas y lo que sabes? Si no (te falta saber cómo o dónde, un acceso, archivos, criterios) → pedir_ayuda y para: sin inventar ni marcar progreso.',
    appTools().length
      ? 'Datos del mundo → leer_web y cita fuente. Para actuar en las apps del propietario (publicar, enviar, guardar en sus documentos) → ver_apps, buscar_accion, usar_accion. Si queda esperando su aprobación, di «pendiente de tu aprobación», nunca «publicado».'
      : 'Datos del mundo → leer_web y cita fuente. Nada de «publicado», «subido» o «enviado»: no tienes cómo hacerlo; como mucho, déjalo preparado para el propietario.',
    t.ongoing ? 'No tiene progreso ni se termina: no la marques como hecha.' : 'Al acabar: actualizar_tarea con progreso realista; terminada → estado review.',
    terse()
      ? 'Responde solo lo producido: tus comentarios telegráficos; los entregables (textos, copys, guiones) completos y bien escritos.'
      : 'Responde solo con lo que has producido en este rato, en 2-8 frases o una lista corta.',
    'Que se lea de un vistazo: párrafos cortos separados por una línea en blanco, listas con guiones para los puntos y **negrita** para lo clave (decisiones, siguiente paso).',
  ].join('\n');
  try {
    const tools = toolsFor(w).filter((x) => !['terminar_conversacion', 'crear_tarea', 'asignar_tarea'].includes(x.name));
    const out = await think(brain, systemFor(w), prompt, tools, async (name, args) => {
      w.busyWith = toolLabel(name);
      if (w.deskWork) w.deskWork.doing = toolLabel(name);
      notify('change');
      publish();
      const r = await useTool(w, null, name, args);
      used.push({ name, note: r.note });
      if (w.deskWork) Object.assign(w.deskWork, { steps: [...used], doing: 'Pensando el siguiente paso' });
      notify('change');
      publish();
      return redact(r.result);
    }, { maxRounds: 5, maxTokens: terse() ? 1100 : 1400 });
    spend(out.tokens);
    const text = tidy(out.text, w.name);
    if (text) {
      t.notes.push({ at: Date.now(), by: w.id, text: text.slice(0, 1500), tools: used });
      if (t.notes.length > NOTES) t.notes.splice(0, t.notes.length - NOTES);
    }
    if (text || used.length) keepWork(w, { taskId: t.id, title: t.title, startedAt }, text || 'Sin nada que entregar en este rato.', used);
    nextAt.set(w.id, Date.now() + EVERY_MS[0] + Math.random() * (EVERY_MS[1] - EVERY_MS[0]));
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    console.error(`[trabajo] ${w.name}: ${msg}`);
    if (e instanceof LlmError && e.status === 429) waitForProvider(e);
    nextAt.set(w.id, Date.now() + Math.max(2 * 60_000, e instanceof LlmError ? e.retryAfterMs : 0));
  } finally {
    busy.delete(w.id);
    w.busyWith = null;
    w.deskWork = null;
    notify('change');
    publish();
  }
}

/** Stretches kept in your chat with them (older ones go first, before any of your messages). */
const WORK_KEEP = 6;

/**
 * The stretch, left in your chat with them folded (it doesn't count as a new message): you can
 * open it to see what they thought and did, and they have it in mind when you talk to them.
 */
function keepWork(w: Worker, work: NonNullable<ChatLine['work']>, text: string, tools: ToolUse[]): void {
  const chat = (w.chat ??= { lines: [], pending: false, thinking: null });
  chat.lines.push({ at: Date.now(), speaker: w.id, text: text.slice(0, 3000), tools, work });
  const works = chat.lines.filter((l) => l.work);
  for (const old of works.slice(0, Math.max(0, works.length - WORK_KEEP))) chat.lines.splice(chat.lines.indexOf(old), 1);
  if (chat.lines.length > 40) chat.lines.splice(0, chat.lines.length - 40);
}

