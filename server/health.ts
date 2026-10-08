/**
 * How healthy the project is, from facts the office can count: how well it knows the product,
 * how much of its time goes on work rather than talk, whether its conversations lead somewhere,
 * how far the work has got and how much of it is stuck. Below the threshold the office stops
 * and calls you in.
 */
import { callMeeting, getState, headOf, log, notify, setStatus, tellOwner } from '../src/sim/ops';
import type { BriefAspect, HealthAspect } from '../src/sim/types';

export const BRIEF_ASPECTS: { id: BriefAspect; label: string }[] = [
  { id: 'que', label: 'Qué es el producto' },
  { id: 'para_quien', label: 'Para quién es' },
  { id: 'problema', label: 'Qué problema resuelve' },
  { id: 'objetivos', label: 'Objetivos y cómo se mide el éxito' },
  { id: 'estado', label: 'En qué punto está' },
  { id: 'canales', label: 'Dónde se vende y se comunica' },
  { id: 'marca', label: 'Marca y tono' },
  { id: 'restricciones', label: 'Presupuesto, plazos y límites' },
  { id: 'prioridades', label: 'Prioridades ahora' },
];

/** Recovering needs a little more than the threshold, so it doesn't flicker in and out. */
const HYSTERESIS = 6;
const WINDOW_MS = 2 * 3600_000;
/** Below the line for this long (not a dip) before anyone is alarmed. */
const SUSTAINED_MS = 10 * 60_000;
/** After a meeting with you: time to put what was agreed to work, with no alarms. */
const CALM_AFTER_MEETING_MS = 90 * 60_000;
const CALM_AFTER_CRISIS_MS = 3 * 3600_000;
/** At most one crisis meeting in this long, whatever the numbers say. */
const CRISIS_GAP_MS = 4 * 3600_000;

/** Every couple of seconds: how many agents were working, how many talking. */
const samples: { t: number; work: number; talk: number }[] = [];
/** Since when the health has been below the line (0: it isn't). */
let belowSince = 0;

export function sampleFocus(): void {
  const st = getState();
  // Only when working is possible: not with the office closed, at the table with you, or with
  // everything paused by a crisis (that would count the pause against them).
  if (!st.working || st.meeting || st.health.crisis) return;
  if (!st.tasks.some((t) => t.status === 'doing')) return;
  let work = 0;
  let talk = 0;
  for (const w of st.workers) {
    if (!w.enabled) continue;
    if (w.activity === 'working' || w.activity === 'pairing' || w.activity === 'reviewing') work++;
    else if (w.activity === 'talking') talk++;
  }
  const now = Date.now();
  samples.push({ t: now, work, talk });
  while (samples.length && samples[0].t < now - WINDOW_MS) samples.shift();
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function computeHealth(): void {
  const st = getState();
  const now = Date.now();
  const brief = st.brief;
  const known = BRIEF_ASPECTS.reduce((n, a) => n + (brief.aspects[a.id]?.confidence ?? 0), 0);
  const open = st.questions.filter((q) => q.answer === null).length;
  const claridad = clamp((known / BRIEF_ASPECTS.length) * 100 - open * 8);

  // After a meeting with you, a clean slate: what happened before it was talked over.
  const lastMeetingEnd = Math.max(st.health.lastMeetingEnd ?? 0, st.meetings[0]?.endedAt ?? 0);
  const since = Math.max(now - WINDOW_MS, lastMeetingEnd);

  const counted = samples.filter((s) => s.t > since);
  const work = counted.reduce((n, s) => n + s.work, 0);
  const talk = counted.reduce((n, s) => n + s.talk, 0);
  const enoughFocus = work + talk >= 60;
  const foco = enoughFocus ? clamp((work / (work + talk)) * 100) : 70;

  // Only conversations that ended on their own: one cut short (the office closed, someone went to
  // a meeting, the AI failed) says nothing about how well they talk.
  const recent = st.conversations.filter((c) => c.endedAt !== null && c.endedAt > since && (c.conclusion || c.looped));
  const good = recent.filter((c) => c.conclusion && !c.looped).length;
  const orden = recent.length < 3 ? 75 : clamp((good / recent.length) * 100);

  // Ongoing jobs never finish: progress is measured on the work that has an end, and only once
  // it has had a day to move (a task created this morning at 0 % isn't a delay).
  const tasks = st.tasks.filter((t) => !t.ongoing && (t.status === 'done' || now - t.createdAt > 24 * 3600_000));
  const avance = tasks.length ? clamp(tasks.reduce((n, t) => n + (t.status === 'done' ? 100 : t.progress), 0) / tasks.length) : 0;

  const active = st.tasks.filter((t) => (t.status === 'doing' || t.status === 'blocked') && !t.heldByCrisis);
  const stuck = active.filter((t) => t.status === 'blocked').length;
  const bloqueos = active.length ? clamp((1 - stuck / active.length) * 100) : 100;

  const aspects: HealthAspect[] = [
    {
      id: 'claridad',
      label: 'Claridad del producto',
      value: claridad,
      weight: 0.35,
      note: brief.kickedOff || Object.keys(brief.aspects).length
        ? `${BRIEF_ASPECTS.filter((a) => (brief.aspects[a.id]?.confidence ?? 0) >= 0.6).length} de ${BRIEF_ASPECTS.length} aspectos claros${open ? `; ${open} duda${open > 1 ? 's' : ''} sin responder` : ''}`
        : 'Aún no les has contado el producto',
    },
    {
      id: 'foco',
      label: 'Foco',
      value: foco,
      weight: enoughFocus ? 0.2 : 0,
      note: enoughFocus ? `${Math.round((work / (work + talk)) * 100)} % del tiempo trabajando, el resto conversando` : 'Aún poco tiempo de trabajo para medirlo: no cuenta',
    },
    {
      id: 'orden',
      label: 'Orden',
      value: orden,
      weight: recent.length < 3 ? 0 : 0.2,
      note: recent.length < 3 ? 'Pocas conversaciones terminadas aún: no cuenta' : `${good} de ${recent.length} conversaciones acabaron en algo concreto`,
    },
    // With no tasks old enough there's no progress to judge: it doesn't count.
    {
      id: 'avance',
      label: 'Avance',
      value: avance,
      weight: tasks.length ? 0.15 : 0,
      note: tasks.length ? `${tasks.filter((t) => t.status === 'done').length} de ${tasks.length} tareas hechas` : 'Las tareas son recientes: aún no cuenta',
    },
    { id: 'bloqueos', label: 'Sin bloqueos', value: bloqueos, weight: 0.1, note: active.length ? `${stuck} de ${active.length} tareas en curso bloqueadas` : 'Nada en curso' },
  ];
  const weights = aspects.reduce((n, a) => n + a.weight, 0);
  const overall = clamp(aspects.reduce((n, a) => n + a.value * a.weight, 0) / weights);

  let crisis = st.health.crisis;
  let crisisAt = st.health.crisisAt ?? 0;
  let calmUntil = st.health.calmUntil ?? 0;
  // Meeting you is the point of a crisis: once you've met after it began, work resumes and they
  // get a long while to put it into practice. Any other meeting buys a shorter calm too.
  if (lastMeetingEnd > 0) calmUntil = Math.max(calmUntil, lastMeetingEnd + (crisisAt && lastMeetingEnd > crisisAt ? CALM_AFTER_CRISIS_MS : CALM_AFTER_MEETING_MS));
  belowSince = overall < st.health.threshold ? belowSince || now : 0;
  // Before the first meeting there's nothing to rescue: the story hasn't started.
  if (!brief.kickedOff) crisis = false;
  // A crisis lives as long as its meeting: once it's over (or if you're no longer at the table), work resumes.
  else if (crisis && (overall >= st.health.threshold + HYSTERESIS || !st.meeting)) crisis = false;
  else if (
    !crisis &&
    st.working &&
    !st.meeting &&
    now >= calmUntil &&
    now - crisisAt > CRISIS_GAP_MS &&
    belowSince &&
    now - belowSince > SUSTAINED_MS &&
    // Only if they can actually sit down with you; otherwise nothing is paused.
    callMeeting('crisis') === null
  ) {
    crisis = true;
    crisisAt = now;
  }

  if (crisis !== st.health.crisis) {
    if (crisis) holdWork(overall);
    else releaseWork(overall);
  }
  const next = { ...st.health, overall, aspects, crisis, crisisAt: crisisAt || undefined, calmUntil: calmUntil || undefined };
  if (JSON.stringify(next) !== JSON.stringify(st.health)) {
    st.health = next;
    notify('change');
  }
}

const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/**
 * Why the project is in trouble, in concrete terms the owner can act on: which parts of the
 * product the office doesn't know, what's blocked and on what, what they've asked and is still
 * unanswered. For the call-in message and for the meeting itself.
 */
/** Word roots (first five letters of each longer word): «validación» and «validar» meet. */
export const roots = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 3)
    .map((w) => w.slice(0, 5));

/** Whether a text is about a topic: every root of the topic shows up in it. */
export function aboutTopic(text: string, topic: string): boolean {
  const want = roots(topic);
  const have = new Set(roots(text));
  return want.length > 0 && want.every((r) => have.has(r));
}

export function troubleFacts(): { missing: string[]; blocked: string[]; questions: string[] } {
  const st = getState();
  const missing = BRIEF_ASPECTS.filter((a) => (st.brief.aspects[a.id]?.confidence ?? 0) < 0.6).map((a) => a.label.toLowerCase());
  // What you've said you handle yourself isn't the team's to chase.
  const theirs = (t: string) => !(st.brief.yours ?? []).some((y) => aboutTopic(t, y));
  const blocked = st.tasks
    .filter((t) => t.status === 'blocked' && !t.heldByCrisis && theirs(t.title))
    .map((t) => `«${short(t.title)}»${t.blockReason ? ` (${short(t.blockReason, 90)})` : ''}`);
  const questions = st.questions.filter((q) => q.answer === null && theirs(q.text)).map((q) => short(q.text, 110));
  return { missing, blocked, questions };
}

/** Below the line: everything in progress pauses until the head has talked it over with you. */
function holdWork(overall: number): void {
  const st = getState();
  for (const t of st.tasks) {
    if (t.status !== 'doing') continue;
    setStatus(t.id, 'blocked');
    t.blockReason = 'En pausa: la dirección necesita aclarar el proyecto contigo';
    t.heldByCrisis = true;
  }
  log('office', `La salud del proyecto ha caído al ${overall} %: se pausa el trabajo y la dirección te convoca`);
  const head = headOf(st.workers);
  if (head) {
    // What exactly is wrong, so you know what you'll be asked before you sit down.
    const f = troubleFacts();
    const why = [
      f.missing.length ? `nos falta saber ${list(f.missing.slice(0, 3))}${f.missing.length > 3 ? ` (y ${f.missing.length - 3} cosa${f.missing.length > 4 ? 's' : ''} más)` : ''}` : '',
      f.blocked.length ? `${f.blocked.length === 1 ? 'hay una tarea bloqueada' : `hay ${f.blocked.length} tareas bloqueadas`}` : '',
      f.questions.length ? `${f.questions.length === 1 ? 'tienes una pregunta' : `tienes ${f.questions.length} preguntas`} sin responder` : '',
    ].filter(Boolean);
    const detail = [
      f.missing.length ? `Lo que falta del producto: ${f.missing.join(', ')}.` : '',
      f.blocked.length ? `Bloqueado: ${f.blocked.slice(0, 4).join('; ')}.` : '',
      f.questions.length ? `Preguntas pendientes: ${f.questions.slice(0, 3).join(' · ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    tellOwner(
      head.id,
      'meeting',
      `La salud del proyecto ha caído al ${overall} % y he parado el trabajo${why.length ? `: ${list(why)}` : ''}. Te esperamos en la sala de reuniones; te preguntaremos lo justo, una cosa cada vez.`,
      detail,
      { type: 'meeting' },
    );
  }
}

function releaseWork(overall: number): void {
  const st = getState();
  for (const t of st.tasks) {
    if (!t.heldByCrisis) continue;
    t.heldByCrisis = false;
    if (t.status === 'blocked') setStatus(t.id, 'doing');
  }
  log('office', `Se retoma el trabajo (salud del proyecto: ${overall} %)`);
}
