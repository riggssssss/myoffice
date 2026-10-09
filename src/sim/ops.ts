/**
 * The office state and every change to it. Pure: no storage, no DOM. The local server owns
 * the one real copy and runs these; the browser only asks for them by name (see COMMANDS).
 *
 * Nothing here is simulated: things change because you (or, later, an agent) did them.
 */
import { DEFAULT_LOOK, randomLook, type Look } from './look';
import { createSeed, DIRECTOR_SLOT, MEETING_SEATS, REQUIRED_NAMES, REQUIRED_ROLES, ROLE_ORDER, ROLES } from './seed';
import { DEFAULT_WORKER_AI, isProvider, type WorkerAi } from './settings';
import { planTemplate, templateOf, type TemplateSlot } from './templates';
import type { Activity, AgentProfile, CalendarEvent, ChatFile, FeedKind, Meeting, MessageAction, OwnerMessage, RoleId, SimState, Task, TaskStatus, TeamId, Worker, WorkRequest } from './types';

const FEED_LIMIT = 250;
/** Head → supervisor → agent. */
export const MAX_DEPTH = 2;

/** 'tick' = numbers moved; 'change' = structure changed (status, assignment…). */
export type ChangeKind = 'tick' | 'change';

/** How long the sceptic stays inside with the head when they come in with a criticism. */
const VISIT_MS = 3 * 60_000;
/**
 * How long a newcomer's welcome lasts: met in reception, walked to the meeting room, sat
 * down with the interviewer. With an AI connected the interview itself will set the length.
 */
export const INTERVIEW_MS = 2 * 60_000;

const present = (w: Worker | undefined): w is Worker => !!w && state.working && w.enabled;

let state: SimState = createSeed();
let notifier: (kind: ChangeKind) => void = () => {};

export function getState(): SimState {
  return state;
}

export function setState(s: SimState): void {
  state = s;
}

/** The host decides what a change means: the server persists and broadcasts. */
export function setNotifier(fn: (kind: ChangeKind) => void): void {
  notifier = fn;
}

export function notify(kind: ChangeKind): void {
  notifier(kind);
}

// ---------- lookups ----------

export const worker = (id: string | null): Worker | undefined =>
  id ? state.workers.find((w) => w.id === id) : undefined;

export const task = (id: string | null): Task | undefined =>
  id ? state.tasks.find((t) => t.id === id) : undefined;

// ---------- org chart (pure helpers, shared with the browser) ----------

export const headOf = (workers: Worker[]) => workers.find((w) => w.reportsTo === null);

export const reportsOf = (workers: Worker[], id: string) => workers.filter((w) => w.reportsTo === id);

/** 0 for the head, 1 for whoever answers to the head… */
export function depthOf(workers: Worker[], id: string): number {
  let d = 0;
  for (let w = workers.find((x) => x.id === id); w?.reportsTo; w = workers.find((x) => x.id === w!.reportsTo)) {
    if (++d > workers.length) break;
  }
  return d;
}

/** How many levels hang below someone (0 = nobody answers to them). */
function heightOf(workers: Worker[], id: string): number {
  const kids = reportsOf(workers, id);
  return kids.length ? 1 + Math.max(...kids.map((k) => heightOf(workers, k.id))) : 0;
}

function inSubtree(workers: Worker[], root: string, id: string): boolean {
  if (root === id) return true;
  return reportsOf(workers, root).some((k) => inSubtree(workers, k.id, id));
}

/** Why `id` can't answer to `bossId` (null if it can). */
export function bossProblem(workers: Worker[], id: string, bossId: string): string | null {
  const boss = workers.find((w) => w.id === bossId);
  if (!boss) return 'Esa persona no existe';
  if (inSubtree(workers, id, bossId)) return 'No puede responder a alguien de su propio equipo';
  if (boss.staff) return `${boss.name} está fuera de la cadena de mando: no supervisa a nadie`;
  if (depthOf(workers, bossId) + 1 + heightOf(workers, id) > MAX_DEPTH) return 'El organigrama tiene como mucho tres niveles';
  return null;
}

// ---------- feed ----------

export function log(kind: FeedKind, text: string, workerId: string | null = null, taskId: string | null = null): void {
  state.feed.unshift({ id: state.nextId++, t: state.clock, kind, text, workerId, taskId });
  if (state.feed.length > FEED_LIMIT) state.feed.length = FEED_LIMIT;
}

// ---------- presence ----------

/** Newcomers meet the interviewer one at a time, as soon as both are in. */
function runInterviews(): void {
  const interviewer = state.workers.find((w) => w.role === 'interviewer');
  for (const w of state.workers) {
    // With AI, the interview lasts as long as the conversation does.
    if (w.interviewSince === null || w.talk || w.interviewSince + INTERVIEW_MS > state.clock) continue;
    w.interviewSince = null;
    w.needsInterview = false;
    log('interview', `${w.name} termina su bienvenida con ${interviewer?.name ?? 'entrevistas'} y va a su puesto`, w.id);
    notify('change');
  }
  if (!present(interviewer) || state.workers.some((w) => w.interviewSince !== null)) return;
  const next = state.workers.find((w) => w.needsInterview && present(w));
  if (!next) return;
  next.interviewSince = state.clock;
  log('interview', `${interviewer.name} recibe a ${next.name} en recepción y van juntos a la sala de reuniones`, next.id);
  notify('change');
}

/** At the table with you right now. */
export const inMeeting = (w: Worker) => !!state.meeting && state.meeting.status !== 'ended' && state.meeting.participants.includes(w.id);

/** What each person is doing follows from the facts: office open, switched on, their task. */
export function refreshActivities(): void {
  runInterviews();
  const interviewing = state.workers.some((w) => w.interviewSince !== null);
  for (const w of state.workers) {
    const t = task(w.taskId);
    if (w.visitUntil !== null && w.visitUntil <= state.clock) w.visitUntil = null;
    let a: Activity;
    if (!state.working || !w.enabled) a = 'away';
    else if (w.interviewSince !== null) a = 'interview';
    else if (w.role === 'interviewer' && interviewing) a = 'interviewing';
    else if (inMeeting(w)) a = 'meeting';
    else if (w.talk) a = 'talking';
    else if (w.role === 'skeptic') a = w.visitUntil ? 'visiting' : 'patrolling';
    else if (w.role === 'organizer') a = 'roaming';
    else if (t?.status === 'blocked') a = 'blocked';
    else if (t?.status === 'doing') a = w.pairWith ? 'pairing' : 'working';
    // Nothing with an end on their desk, but an ongoing job: that's what they're working on.
    else if (ongoingOf(w).length) a = 'working';
    else a = 'idle';
    if (a !== w.activity) {
      w.activity = a;
      notify('change');
    }
  }
}

// ---------- office ----------

export function setWorking(on: boolean): void {
  if (state.working === on) return;
  state.working = on;
  log('office', on ? 'Se abre la oficina: el equipo entra a trabajar' : 'Se cierra la oficina: el equipo se va a casa');
  notify('change');
}

export function setOfficeInfo(agency: string, project: string): void {
  state.agency = agency;
  state.project = project;
  notify('change');
}

// ---------- people ----------

export interface WorkerInput {
  name: string;
  role: RoleId;
  title: string;
  reportsTo: string | null;
  profile?: AgentProfile;
}

export const PROFILE_MAX = { summary: 400, persona: 1500, focus: 8, focusItem: 160 };

export function isProfile(v: unknown): v is AgentProfile {
  const o = v as AgentProfile;
  return (
    !!o && typeof o === 'object' &&
    str(o.summary, PROFILE_MAX.summary) && o.summary.trim().length > 0 &&
    str(o.persona, PROFILE_MAX.persona) &&
    Array.isArray(o.focus) && o.focus.length <= PROFILE_MAX.focus && o.focus.every((f) => str(f, PROFILE_MAX.focusItem))
  );
}

export const cleanProfile = (p: AgentProfile): AgentProfile => ({
  summary: p.summary.trim(),
  persona: p.persona.trim(),
  focus: p.focus.map((f) => f.trim()).filter(Boolean),
});

/** The four roles every office has, one each. */
export const isRequired = (w: Pick<Worker, 'role'>) => REQUIRED_ROLES.includes(w.role);

/** Who works at a desk: everyone you hire, plus the head in their office. */
export const deskOwners = (workers: Worker[]) => workers.filter((w) => !isRequired(w) || w.role === 'director');

/** The figure most of the office has (so newcomers don't look out of place). */
function usualModel(): Look['model'] {
  const count = new Map<Look['model'], number>();
  for (const w of state.workers) count.set(w.look.model, (count.get(w.look.model) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_LOOK.model;
}

export function hire(name: string, role: RoleId, title: string, reportsTo: string | null, profile?: AgentProfile): Worker {
  const used = new Set(state.workers.map((w) => w.desk));
  let desk = 0;
  while (used.has(desk)) desk++;
  const w: Worker = {
    id: `w${state.nextId++}`,
    name,
    title: title || ROLES[role].title,
    role,
    desk,
    // The fixed roles keep the office's usual look; everyone else gets their own.
    look: REQUIRED_ROLES.includes(role) ? { ...DEFAULT_LOOK } : { ...randomLook(), model: usualModel() },
    reportsTo,
    // The sceptic is outside the chain of command (and outside the office).
    staff: role === 'skeptic',
    enabled: true,
    activity: 'away',
    taskId: null,
    pairWith: null,
    visitUntil: null,
    // Everyone you hire is welcomed and interviewed, unless they come with their card written;
    // the four fixed roles open the office.
    needsInterview: !REQUIRED_ROLES.includes(role) && !profile,
    interviewSince: null,
    talk: null,
    brief: null,
    busyWith: null,
    ai: { ...DEFAULT_WORKER_AI, mcps: [] },
    ...(profile ? { profile } : {}),
  };
  state.workers.push(w);
  return w;
}

/**
 * Every office has a head (Dirección), an organiser, an interviewer and a sceptic. Hires
 * whichever is missing and puts them in place: the head on top, the other three answering to it.
 */
export function ensureRequired(): void {
  state.conversations ??= [];
  state.requests ??= [];
  state.questions ??= [];
  state.brief ??= { aspects: {}, kickedOff: false };
  state.brief.rulings ??= [];
  state.brief.yours ??= [];
  state.brief.links ??= [];
  state.health ??= { overall: 0, aspects: [], threshold: 45, crisis: false };
  state.meeting ??= null;
  state.meetings ??= [];
  state.events ??= [];
  state.inbox ??= [];
  state.hireIdeas ??= { status: 'idle', items: [], basis: '', at: 0, by: null, note: '' };
  // Cut off by a restart: ask again.
  if (state.hireIdeas.status === 'thinking') state.hireIdeas.status = 'asked';
  for (const t of state.tasks) t.notes ??= [];
  for (const q of state.questions) q.taskId ??= null;
  for (const r of state.requests) r.via ??= null;
  state.ai ??= { state: 'off', note: '', day: '', tokensToday: 0, limit: 0, resting: [], using: null, reason: null, back: null };
  state.ai.resting ??= [];
  state.ai.using ??= null;
  state.ai.reason ??= null;
  state.ai.back ??= null;
  let head = state.workers.find((w) => w.role === 'director');
  if (!head) head = hire(REQUIRED_NAMES.director, 'director', '', null);
  if (head.reportsTo !== null) {
    const old = headOf(state.workers);
    if (old && old !== head) old.reportsTo = head.id;
    head.reportsTo = null;
  }
  head.staff = false;
  // Their desk is the one in their own office.
  head.desk = DIRECTOR_SLOT;
  for (const role of ['organizer', 'interviewer', 'skeptic'] as const) {
    const w = state.workers.find((x) => x.role === role) ?? hire(REQUIRED_NAMES[role], role, '', head.id);
    w.reportsTo = head.id;
  }
  for (const w of state.workers) {
    w.visitUntil ??= null;
    w.needsInterview ??= false;
    w.interviewSince ??= null;
    w.ai = { ...DEFAULT_WORKER_AI, ...w.ai };
    w.talk ??= null;
    w.brief ??= null;
    w.busyWith = null;
    w.staff = w.role === 'skeptic';
    if (w !== head && (w.reportsTo === null || worker(w.reportsTo)?.staff || depthOf(state.workers, w.id) > MAX_DEPTH)) w.reportsTo = head.id;
  }
}

/**
 * What hiring suggestions are drawn from: the product, the dossier and who's already in.
 * When it changes, the suggestions you see are out of date.
 */
export function hireBasis(st: SimState = state): string {
  const brief = Object.entries(st.brief.aspects)
    .map(([k, a]) => `${k}:${a?.text}`)
    .sort()
    .join('|');
  const team = st.workers
    .map((w) => `${w.role}:${w.title}`)
    .sort()
    .join('|');
  let h = 5381;
  for (const ch of `${st.project}#${brief}#${team}#${(st.brief.wanted ?? []).join('|')}`) h =((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** Ask the head who the project needs (again, with `force`, even if nothing changed). */
export function askHireIdeas(force: boolean): void {
  const h = state.hireIdeas;
  if (h.status === 'asked' || h.status === 'thinking') return;
  if (!force && h.status === 'ready' && h.basis === hireBasis()) return;
  h.status = 'asked';
  notify('change');
}

/** Hires someone under the boss of your choice (the head by default). */
export function addWorker(input: WorkerInput): string | null {
  if (isRequired(input)) return `Ya hay ${ROLES[input.role].label.toLowerCase()} en la oficina: solo puede haber una persona en ese puesto`;
  const head = headOf(state.workers)!;
  let boss = worker(input.reportsTo) ?? head;
  if (boss.staff || depthOf(state.workers, boss.id) + 1 > MAX_DEPTH) boss = head;
  const w = hire(input.name, input.role, input.title, boss.id, input.profile);
  log('team', `${w.name} se incorpora como ${w.title.toLowerCase()}`, w.id);
  // A suggestion taken up leaves the list.
  const same = (a: string) => a.trim().toLowerCase() === w.title.trim().toLowerCase();
  state.hireIdeas.items = state.hireIdeas.items.filter((i) => !(i.role === w.role && same(i.title)));
  notify('change');
  return null;
}

export function updateWorker(id: string, patch: Omit<WorkerInput, 'reportsTo'>): string | null {
  const w = worker(id);
  if (!w) return null;
  // The three fixed roles stay what they are, and nobody else can take one.
  if (isRequired(w) && patch.role !== w.role) return 'Es un puesto fijo de la oficina: puedes cambiar el nombre y el puesto, no el rol';
  if (!isRequired(w) && isRequired(patch)) return `Ya hay ${ROLES[patch.role].label.toLowerCase()} en la oficina`;
  w.name = patch.name;
  w.title = patch.title || ROLES[patch.role].title;
  w.role = patch.role;
  notify('change');
  return null;
}

/** A name for a newcomer: the first of the post's that's free (and never a fixed role's). */
function freeName(names: string[]): string {
  const taken = new Set([...state.workers.map((w) => w.name.toLowerCase()), ...Object.values(REQUIRED_NAMES).map((n) => n.toLowerCase())]);
  const free = names.find((n) => !taken.has(n.toLowerCase()));
  if (free) return free;
  let i = 2;
  while (taken.has(`${names[0]} ${i}`.toLowerCase())) i++;
  return `${names[0]} ${i}`;
}

/**
 * Sets up a ready-made team (see templates.ts): the plan is worked out again here, and of the
 * people it would adopt only those in `keep` are moved; every other post is a new hire with its
 * card. `profiles`: adopted people without a card get the post's.
 */
export function applyTemplate(id: TeamId, choice: { keep: string[]; profiles: boolean }): { created: string[]; joined: string[]; lead: string } | string {
  const head = headOf(state.workers);
  if (!head) return 'La oficina no tiene dirección';
  const t = templateOf(id);
  const plan = planTemplate(state.workers, id);
  const keep = new Set(choice.keep);
  const created: string[] = [];
  const joined: string[] = [];
  const card = (w: Worker, slot: TemplateSlot) => {
    if (choice.profiles && !w.profile) setProfileOf(w, slot.profile);
  };
  // The lead first, answering to the head.
  let lead = plan.lead.adopt && keep.has(plan.lead.adopt) ? worker(plan.lead.adopt)! : null;
  if (lead) {
    if (lead.reportsTo !== head.id && !bossProblem(state.workers, lead.id, head.id)) lead.reportsTo = head.id;
    card(lead, t.lead);
    joined.push(lead.id);
  } else {
    lead = hire(freeName(t.lead.names), t.lead.role, t.lead.title, head.id, t.lead.profile);
    created.push(lead.id);
  }
  lead.team = id;
  // Then each post: the person it adopts, or someone new.
  for (const seat of plan.members) {
    const w = seat.adopt && keep.has(seat.adopt) ? worker(seat.adopt) : null;
    if (w && !bossProblem(state.workers, w.id, lead.id)) {
      w.reportsTo = lead.id;
      w.staff = false;
      w.team = id;
      card(w, seat.slot);
      joined.push(w.id);
      continue;
    }
    const n = hire(freeName(seat.slot.names), seat.slot.role, seat.slot.title, lead.id, seat.slot.profile);
    n.team = id;
    created.push(n.id);
  }
  // People of the team's roles who were loose under the head join too, if you said so.
  for (const wid of plan.extras) {
    const w = worker(wid);
    if (!w || !keep.has(wid) || bossProblem(state.workers, w.id, lead.id)) continue;
    w.reportsTo = lead.id;
    w.team = id;
    joined.push(w.id);
  }
  const names = (ids: string[]) => ids.map((x) => worker(x)!.name).join(', ');
  log(
    'team',
    `Se monta ${t.label}: ${lead.name} lo dirige${created.length ? `; llegan ${names(created.filter((x) => x !== lead!.id))}` : ''}${joined.filter((x) => x !== lead!.id).length ? `; se suman ${names(joined.filter((x) => x !== lead!.id))}` : ''}`,
    lead.id,
  );
  notify('change');
  return { created, joined, lead: lead.id };
}

/** A card given without the rest of setProfile's bookkeeping being lost. */
function setProfileOf(w: Worker, profile: AgentProfile): void {
  w.profile = { ...profile, focus: [...profile.focus] };
  if (w.needsInterview && w.interviewSince === null) w.needsInterview = false;
}

/** Their card: written, rewritten or taken away. With one, there's no interview left to do. */
export function setProfile(id: string, profile: AgentProfile | null): void {
  const w = worker(id);
  if (!w) return;
  if (profile) setProfileOf(w, profile);
  else delete w.profile;
  notify('change');
}

/** Moves someone under another boss. The three fixed roles stay where they are. */
export function setBoss(id: string, bossId: string): string | null {
  const w = worker(id);
  if (!w) return 'Esa persona no existe';
  if (isRequired(w)) return `${w.name} tiene un puesto fijo: ${w.role === 'director' ? 'dirige la oficina' : 'responde a dirección'}`;
  if (w.reportsTo === bossId) return null;
  const problem = bossProblem(state.workers, id, bossId);
  if (problem) return problem;
  w.reportsTo = bossId;
  w.staff = false;
  log('team', `${w.name} pasa a responder a ${worker(bossId)!.name}`, w.id);
  notify('change');
  return null;
}

/** Lets someone go: their tasks go back to pending, their team moves up to their boss. */
export function removeWorker(id: string): string | null {
  const w = worker(id);
  if (!w) return null;
  if (isRequired(w)) return `${w.name} tiene un puesto fijo: puedes desactivarlo, no quitarlo`;
  for (const k of reportsOf(state.workers, id)) k.reportsTo = w.reportsTo;
  for (const t of state.tasks) {
    if (t.assigneeId !== id) continue;
    t.assigneeId = null;
    if (t.status === 'doing' || t.status === 'blocked') t.status = 'backlog';
  }
  for (const o of state.workers) if (o.pairWith === id) o.pairWith = null;
  state.workers = state.workers.filter((x) => x.id !== id);
  log('team', `${w.name} deja la oficina`);
  notify('change');
  return null;
}

/** Which AI someone thinks with and which connectors they use. */
export function setWorkerAi(id: string, patch: Partial<WorkerAi>): void {
  const w = worker(id);
  if (!w) return;
  w.ai = { ...w.ai, ...patch };
  notify('change');
}

/** The sceptic comes in from outside to tell the head what they think is wrong. */
export function callSkeptic(): string | null {
  const s = state.workers.find((w) => w.role === 'skeptic');
  const head = headOf(state.workers);
  if (!s || !head) return null;
  if (!state.working || !s.enabled) return `${s.name} no está en la oficina ahora mismo`;
  s.visitUntil = state.clock + VISIT_MS;
  log('critique', `${s.name} entra a hablar con ${head.name}`, s.id);
  notify('change');
  return null;
}

export function setEnabled(workerId: string, on: boolean): void {
  const w = worker(workerId);
  if (!w || w.enabled === on) return;
  w.enabled = on;
  log('office', on ? `${w.name} vuelve al equipo` : `${w.name} se queda en casa`, w.id);
  notify('change');
}

export function setPair(workerId: string, partnerId: string | null): void {
  const w = worker(workerId);
  if (!w || w.pairWith === partnerId || partnerId === workerId) return;
  // Nobody sits at a desk whose owner is away pairing.
  if (partnerId) {
    const partner = worker(partnerId);
    if (!partner) return;
    if (partner.pairWith === w.id) partner.pairWith = null;
    for (const other of state.workers) if (other.pairWith === w.id) other.pairWith = null;
    w.pairWith = partnerId;
    log('pair', `${w.name} se sienta con ${partner.name}`, w.id, w.taskId);
  } else {
    log('unpair', `${w.name} vuelve a su mesa`, w.id, null);
    w.pairWith = null;
  }
  notify('change');
}

/** Seat a worker at another desk; whoever sat there takes the worker's old desk. */
export function setDesk(workerId: string, slot: number): void {
  const w = worker(workerId);
  if (!w || w.desk === slot) return;
  const other = state.workers.find((o) => o.desk === slot);
  if (other) other.desk = w.desk;
  w.desk = slot;
  notify('change');
}

/** Replaces the look object, so the scene can spot the change by identity. */
export function updateLook(workerId: string, patch: Partial<Look>): void {
  const w = worker(workerId);
  if (!w) return;
  const next = { ...DEFAULT_LOOK, ...w.look, ...patch };
  // A hood only exists on a hoodie.
  if (next.top !== 'hoodie' && next.headwear === 'hood') next.headwear = 'none';
  w.look = next;
  notify('change');
}

// ---------- tasks ----------

/** Put a worker's current task back in the backlog (keeps its progress). */
/** Puts down what they're on. `requeue`: it stays theirs, first in their queue; else it goes back unassigned. */
function release(w: Worker, requeue = false): void {
  const current = task(w.taskId);
  if (current && (current.status === 'doing' || current.status === 'blocked')) {
    current.status = 'backlog';
    // Back in their own queue it keeps everything: progress, notes and what it's waiting on.
    if (!requeue) {
      current.assigneeId = null;
      current.blockReason = null;
    }
  }
  w.taskId = null;
}

const active = (t: Task | undefined) => !!t && (t.status === 'doing' || t.status === 'blocked');

/** Their ongoing jobs that are running (not stopped, not blocked). */
export const ongoingOf = (w: Pick<Worker, 'id'>) => state.tasks.filter((t) => t.ongoing && t.assigneeId === w.id && t.status === 'doing');

/** Tasks waiting for someone, in the order they'll take them. */
export const queueOf = (tasks: Task[], w: Pick<Worker, 'id' | 'taskId'>) =>
  tasks
    .filter((t) => t.assigneeId === w.id && t.status === 'backlog' && !t.ongoing && t.id !== w.taskId)
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt - b.createdAt);

/**
 * You drag a task to a place in someone's line (or out to nobody): it becomes theirs, the line
 * takes the order you left, and whatever is first is what they're on now. What goes back keeps
 * its progress and notes, and picks up from there when it comes round again.
 */
export function placeTask(taskId: string, workerId: string | null, order: string[]): void {
  const t = task(taskId);
  if (!t || t.ongoing || t.status === 'done') return;
  if (!workerId) {
    if (t.assigneeId) assignTask(t.id, null);
    t.order = undefined;
    notify('change');
    return;
  }
  const w = worker(workerId);
  if (!w) return;
  if (t.assigneeId !== w.id || t.status === 'review') assignTask(t.id, w.id);
  // Their line as you left it: only their own unfinished tasks, in that order, the rest after.
  const mine = (x: Task) => x.assigneeId === w.id && !x.ongoing && (x.status === 'backlog' || x.status === 'doing' || x.status === 'blocked');
  const line = order.map((id) => task(id)).filter((x): x is Task => !!x && mine(x));
  for (const x of state.tasks) if (mine(x) && !line.includes(x)) line.push(x);
  line.forEach((x, i) => (x.order = i));
  const first = line[0];
  if (first && w.taskId !== first.id) {
    startTask(w, first);
    log('edit', `${w.name} pasa a «${first.title}»`, w.id, first.id);
  }
  notify('change');
}

/** Free again: they pick up the next task in their queue, if any. */
function startNext(w: Worker | undefined): void {
  if (!w || w.taskId) return;
  const next = queueOf(state.tasks, w)[0];
  if (next) startTask(w, next);
}

function startTask(w: Worker, t: Task): void {
  if (w.taskId === t.id) return;
  // An ongoing job runs alongside: it never takes the place of what they're on.
  if (t.ongoing) {
    t.assigneeId = w.id;
    t.status = t.blockReason ? 'blocked' : 'doing';
    log('start', `${w.name} se encarga de «${t.title}» de forma continua`, w.id, t.id);
    return;
  }
  release(w, true);
  const prev = worker(t.assigneeId);
  if (prev && prev.taskId === t.id) prev.taskId = null;
  t.assigneeId = w.id;
  t.status = t.blockReason ? 'blocked' : 'doing';
  w.taskId = t.id;
  log('start', `${w.name} empieza «${t.title}»`, w.id, t.id);
}

export function assignTask(taskId: string, workerId: string | null): void {
  const t = task(taskId);
  if (!t) return;
  const prev = worker(t.assigneeId);
  if (!workerId) {
    if (prev && prev.taskId === t.id) release(prev);
    else t.assigneeId = null;
    if (t.status === 'doing' || t.status === 'blocked') t.status = 'backlog';
    startNext(prev);
  } else {
    const w = worker(workerId);
    if (!w) return;
    if (t.status === 'done' || t.status === 'review') {
      t.status = 'backlog';
      t.doneAt = null;
    }
    // Busy with something else: it waits in their queue (an ongoing job just starts alongside).
    if (!t.ongoing && w.taskId !== t.id && active(task(w.taskId))) {
      if (prev && prev !== w && prev.taskId === t.id) {
        prev.taskId = null;
        startNext(prev);
      }
      t.assigneeId = w.id;
      t.status = 'backlog';
      log('edit', `«${t.title}» queda en la cola de ${w.name}`, w.id, t.id);
    } else {
      startTask(w, t);
      if (prev && prev !== w) startNext(prev);
    }
  }
  notify('change');
}

export interface TaskInput {
  title: string;
  role: RoleId;
  estimate: number;
  assigneeId: string | null;
  /** No end: runs until you stop it. */
  ongoing?: boolean;
}

export function createTask(input: TaskInput): Task {
  const t: Task = {
    id: `t${state.nextId++}`,
    title: input.title,
    role: input.role,
    assigneeId: null,
    status: 'backlog',
    progress: 0,
    estimate: input.estimate,
    createdAt: state.clock,
    doneAt: null,
    blockReason: null,
    notes: [],
    ongoing: input.ongoing === true,
  };
  state.tasks.push(t);
  log('create', input.assigneeId ? `Nueva tarea «${t.title}»` : `Nueva tarea «${t.title}», pendiente de asignar`, null, t.id);
  if (input.assigneeId) assignTask(t.id, input.assigneeId);
  notify('change');
  return t;
}

export function updateTask(id: string, patch: TaskInput & { status: TaskStatus }): void {
  const t = task(id);
  if (!t) return;
  t.title = patch.title;
  t.role = patch.role;
  t.estimate = patch.estimate;
  if (typeof patch.ongoing === 'boolean' && patch.ongoing !== !!t.ongoing) {
    // Becoming ongoing frees their desk for the next in their queue; becoming finite takes a place in it.
    const owner = worker(t.assigneeId);
    const running = t.status === 'doing' || t.status === 'blocked' || t.status === 'backlog';
    if (owner?.taskId === t.id) owner.taskId = null;
    t.ongoing = patch.ongoing;
    if (owner && running) {
      t.status = 'backlog';
      assignTask(t.id, owner.id);
    }
    startNext(owner);
  }
  if (patch.assigneeId !== t.assigneeId) assignTask(id, patch.assigneeId);
  if (patch.status !== t.status) setStatus(id, patch.status);
  log('edit', `Tarea «${t.title}» actualizada`, null, t.id);
  notify('change');
}

/** You ask for something in your own words; the organiser makes the tasks (server side, with their AI). */
export function requestWork(text: string, via: string | null = null): void {
  const to = via ? worker(via) : undefined;
  if (via && !to) return;
  const r: WorkRequest = { id: `q${state.nextId++}`, text, at: state.clock, status: 'waiting', reply: null, tools: [], tool: null, doneAt: null, via: to?.id ?? null };
  state.requests.unshift(r);
  state.requests.length = Math.min(state.requests.length, 40);
  const organizer = state.workers.find((w) => w.role === 'organizer');
  const short = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  if (to) log('create', `Le escribes a ${to.name}: «${short}». Lo hablará con ${organizer?.name ?? 'Organización'}`, to.id);
  else log('create', `Encargo para ${organizer?.name ?? 'Organización'}: «${short}»`, organizer?.id ?? null);
  notify('change');
}

/** Your answer to something an agent needed; it reaches them through their notes (server side). */
export function answerQuestion(id: string, text: string, inChat = false): void {
  const q = state.questions.find((x) => x.id === id);
  if (!q || q.answer !== null) return;
  q.answer = text;
  q.answeredAt = state.clock;
  // Answered from «Para ti»: it shows in the chat where they asked, too.
  const asker = worker(q.byId ?? q.workerId);
  if (!inChat && asker?.chat?.lines.some((l) => l.question === id)) {
    asker.chat.lines.push({ at: state.clock, speaker: 'owner', text, tools: [] });
    asker.chat.unread = 0;
  }
  // The message that asked it has been dealt with.
  for (const m of state.inbox) if (m.action?.type === 'answer' && m.action.questionId === id) Object.assign(m, { closed: true, read: true });
  log('question', `Respondes a ${worker(q.workerId)?.name ?? 'alguien'}: «${text.length > 80 ? `${text.slice(0, 80)}…` : text}»`, q.workerId);
  notify('change');
}

// ---------- meetings with you ----------

/**
 * You sit down with the office's top rows: the head and whoever answers to them. The very
 * first one (the story begins) is just the head and Entrevistas, to hear what the product is.
 */
export function callMeeting(kind: Meeting['kind'] = 'review'): string | null {
  if (state.meeting && state.meeting.status !== 'ended') return 'Ya hay una reunión en marcha';
  if (!state.working) return 'La oficina está cerrada: pulsa Trabajar para que vengan a reunirse contigo';
  const head = headOf(state.workers);
  if (!head) return null;
  const first = !state.brief.kickedOff;
  const people = first
    ? [head, ...state.workers.filter((w) => w.role === 'interviewer')]
    : [head, ...reportsOf(state.workers, head.id).filter((w) => !w.staff)];
  // As many as there are chairs: the organizer, then whoever leads a team, then the rest.
  const rank = (w: Worker) => (w === head ? 0 : w.role === 'organizer' ? 1 : reportsOf(state.workers, w.id).length ? 2 : w.role === 'interviewer' ? 3 : 4);
  const here = people
    .filter((w) => w.enabled)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MEETING_SEATS);
  if (!here.length) return 'No hay nadie de la dirección en la oficina';
  state.meeting = {
    id: `m${state.nextId++}`,
    kind: first ? 'kickoff' : kind,
    participants: here.map((w) => w.id),
    status: 'gathering',
    startedAt: state.clock,
    endedAt: null,
    lines: [],
    waitingFor: 'agents',
    thinking: null,
    summary: null,
  };
  log('meeting', first ? `Empieza la historia: te reúnes con ${here.map((w) => w.name).join(' y ')} para contarles el producto` : `Reunión contigo: ${here.map((w) => w.name).join(', ')}`);
  notify('change');
  return null;
}

/** You say something at the table; they answer from the server. */
export function ownerSay(text: string): void {
  const m = state.meeting;
  if (!m || m.status !== 'live') return;
  m.lines.push({ at: state.clock, speaker: 'owner', text, tools: [] });
  m.waitingFor = 'agents';
  notify('change');
}

/** Lines kept per chat: enough to follow the thread, small enough to quote to their AI. */
const CHAT_KEEP = 40;

/** Files you attach are looked up where they're kept (the server says how). */
let findFile: (id: string) => ChatFile | null = () => null;
export const setFileFinder = (fn: (id: string) => ChatFile | null) => (findFile = fn);
/** A very long message is kept as a document (the server says how), so the chat stays light. */
let keepLong: (text: string) => ChatFile | null = () => null;
export const setLongKeeper = (fn: (text: string) => ChatFile | null) => (keepLong = fn);
const LONG = 12_000;

/** You write to someone directly; they answer in the same chat (server side, with their AI). */
export function ownerChat(workerId: string, text: string, fileIds: string[] = []): void {
  const w = worker(workerId);
  if (!w) return;
  const files = fileIds.map(findFile).filter((f): f is ChatFile => !!f);
  if (!text && !files.length) return;
  if (text.length > LONG) {
    const doc = keepLong(text);
    if (doc) {
      files.unshift(doc);
      text = `${text.slice(0, 1200).trimEnd()}… (el texto completo va en ${doc.name})`;
    }
  }
  const chat = (w.chat ??= { lines: [], pending: false, thinking: null });
  chat.lines.push({ at: state.clock, speaker: 'owner', text, tools: [], ...(files.length ? { files } : {}) });
  chat.unread = 0;
  // What they asked you in this chat: your reply here is the answer (their paused work resumes).
  const asked = state.questions.filter((q) => q.answer === null && (q.byId ?? q.workerId) === w.id).at(-1);
  if (asked && text) answerQuestion(asked.id, text, true);
  if (chat.lines.length > CHAT_KEEP) chat.lines.splice(0, chat.lines.length - CHAT_KEEP);
  chat.pending = true;
  notify('change');
}

/** You step into a conversation between two of them: your words go in, and they answer you. */
export function ownerTalk(convId: string, text: string): string | null {
  const c = state.conversations.find((x) => x.id === convId);
  if (!c) return 'Esa conversación ya no está';
  if (c.endedAt !== null) return 'Esa conversación ya ha terminado: escríbele en su chat privado';
  c.lines.push({ at: state.clock, speaker: 'owner', text, tools: [] });
  c.joined = (c.joined ?? 0) + 1;
  notify('change');
  return null;
}

const ARCHIVE_KEEP = 20;

/** You've seen their messages. */
export function readChat(workerId: string): void {
  const chat = worker(workerId)?.chat;
  if (!chat?.unread) return;
  chat.unread = 0;
  notify('change');
}

/** A fresh chat with them: the current one is kept in their file (Ajustes) and they start anew. */
export function resetChat(workerId: string): void {
  const chat = worker(workerId)?.chat;
  if (!chat || chat.thinking || !chat.lines.length) return;
  chat.archive = [{ at: Date.now(), lines: chat.lines }, ...(chat.archive ?? [])].slice(0, ARCHIVE_KEEP);
  chat.lines = [];
  chat.pending = false;
  notify('change');
}

export function deleteChatArchive(workerId: string, at: number): void {
  const chat = worker(workerId)?.chat;
  if (!chat?.archive) return;
  chat.archive = chat.archive.filter((a) => a.at !== at);
  notify('change');
}

/** You close the meeting: the head writes the minutes. */
export function endMeeting(): void {
  const m = state.meeting;
  if (!m || m.status === 'closing' || m.status === 'ended') return;
  m.status = m.lines.length ? 'closing' : 'ended';
  if (m.status === 'ended') {
    m.endedAt = state.clock;
    state.meeting = null;
    // Closed before anyone spoke: it still counts as having met (see server/health.ts).
    state.health.lastMeetingEnd = Date.now();
  }
  notify('change');
}

// ---------- messages to you ----------

/** An agent tells you something directly: it lands in your inbox and pops up bottom left. */
export function tellOwner(from: string, kind: OwnerMessage['kind'], text: string, detail = '', action: MessageAction | null = null): OwnerMessage {
  // Reminders and replies are for your information; the rest wait for you to do something.
  const informs = kind === 'reminder' || kind === 'reply';
  const m: OwnerMessage = { id: `n${state.nextId++}`, at: Date.now(), from, kind, text, detail, action, read: false, closed: !action || informs };
  state.inbox.unshift(m);
  state.inbox.length = Math.min(state.inbox.length, 120);
  notify('change');
  return m;
}

/** Seen: they stop popping up. */
export function readMessages(ids: string[] | 'all'): void {
  for (const m of state.inbox) if (!m.read && (ids === 'all' || ids.includes(m.id))) m.read = true;
  notify('change');
}

/** Done with it (acted on, or not now). */
export function closeMessage(id: string): void {
  const m = state.inbox.find((x) => x.id === id);
  if (!m || m.closed) return;
  m.closed = true;
  m.read = true;
  notify('change');
}

// ---------- calendar ----------

export interface EventInput {
  title: string;
  start: number;
  allDay: boolean;
  note: string;
}

const isEventInput = (v: unknown): v is EventInput => {
  const o = v as EventInput;
  return !!o && str(o.title, 120) && o.title.trim().length > 0 && Number.isFinite(o.start) && typeof o.allDay === 'boolean' && str(o.note ?? '', 500);
};

/** Puts something on the calendar; `by` is 'owner' or the agent who schedules it. */
export function addEvent(input: EventInput, by = 'owner'): CalendarEvent {
  const e: CalendarEvent = { id: `e${state.nextId++}`, title: input.title.trim(), start: input.start, allDay: input.allDay, note: (input.note ?? '').trim(), by, told: [] };
  state.events.push(e);
  state.events.sort((a, b) => a.start - b.start);
  const who = by === 'owner' ? null : worker(by);
  log('calendar', `${who ? `${who.name} apunta` : 'Apuntas'} en el calendario «${e.title}»`, who?.id ?? null);
  notify('change');
  return e;
}

export function updateEvent(id: string, input: EventInput): void {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  // Moved to another time: its reminders are due again.
  if (e.start !== input.start || e.allDay !== input.allDay) e.told = [];
  Object.assign(e, { title: input.title.trim(), start: input.start, allDay: input.allDay, note: (input.note ?? '').trim() });
  state.events.sort((a, b) => a.start - b.start);
  notify('change');
}

export function deleteEvent(id: string): void {
  const before = state.events.length;
  state.events = state.events.filter((x) => x.id !== id);
  if (state.events.length !== before) notify('change');
}

/** Forget finished conversations (live ones carry on). What agents learned stays in their notes. */
export function clearConversations(): void {
  const before = state.conversations.length;
  state.conversations = state.conversations.filter((c) => c.endedAt === null);
  if (state.conversations.length !== before) notify('change');
}

export function deleteTask(id: string): void {
  const t = task(id);
  if (!t) return;
  const owner = worker(t.assigneeId);
  if (owner?.taskId === id) owner.taskId = null;
  state.tasks = state.tasks.filter((x) => x.id !== id);
  startNext(owner);
  log('edit', `Tarea «${t.title}» eliminada`);
  notify('change');
}

export function setStatus(id: string, status: TaskStatus): void {
  const t = task(id);
  if (!t || t.status === status) return;
  const owner = worker(t.assigneeId);
  switch (status) {
    case 'blocked':
      block(t, 'Bloqueada a mano');
      break;
    case 'doing':
      if (t.status === 'blocked') unblock(t);
      else if (owner) startTask(owner, t);
      else t.status = 'backlog';
      break;
    case 'backlog':
      if (owner && owner.taskId === t.id) release(owner);
      t.status = 'backlog';
      t.assigneeId = null;
      startNext(owner);
      break;
    case 'review':
      t.status = 'review';
      t.blockReason = null;
      log('review', `«${t.title}» pasa a revisión`, owner?.id ?? null, t.id);
      freeOwner(t);
      break;
    case 'done':
      complete(t);
      break;
  }
  notify('change');
}

function block(t: Task, reason: string): void {
  t.status = 'blocked';
  t.blockReason = reason;
  const owner = worker(t.assigneeId);
  log('blocked', `${owner ? `${owner.name} tiene un bloqueo` : 'Bloqueo'} en «${t.title}»: ${reason.toLowerCase()}`, owner?.id ?? null, t.id);
}

function unblock(t: Task): void {
  t.status = t.assigneeId ? 'doing' : 'backlog';
  t.blockReason = null;
  const owner = worker(t.assigneeId);
  log('unblocked', `«${t.title}» desbloqueada`, owner?.id ?? null, t.id);
  notify('change');
}

function freeOwner(t: Task): void {
  const owner = worker(t.assigneeId);
  if (owner && owner.taskId === t.id) {
    owner.taskId = null;
    if (owner.pairWith) {
      log('unpair', `${owner.name} termina y vuelve a su mesa`, owner.id, null);
      owner.pairWith = null;
    }
    startNext(owner);
  }
}

function complete(t: Task): void {
  if (!t.ongoing) t.progress = 100;
  t.status = 'done';
  t.doneAt = state.clock;
  t.blockReason = null;
  log('done', t.ongoing ? `Paras «${t.title}»` : `«${t.title}» terminada`, t.assigneeId, t.id);
  freeOwner(t);
}

export function reset(): void {
  state = createSeed();
  ensureRequired();
  notify('change');
}

// ---------- remote commands ----------

const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const idOrNull = (v: unknown): v is string | null => v === null || str(v, 64);
const ROLE_IDS = new Set<RoleId>(ROLE_ORDER);
const STATUSES = new Set<TaskStatus>(['backlog', 'doing', 'blocked', 'review', 'done']);
const isTaskInput = (v: unknown): v is TaskInput => {
  const o = v as TaskInput;
  return (
    !!o && str(o.title) && o.title.trim().length > 0 && ROLE_IDS.has(o.role) &&
    typeof o.estimate === 'number' && o.estimate > 0 && o.estimate <= 1000 && idOrNull(o.assigneeId) &&
    (o.ongoing === undefined || typeof o.ongoing === 'boolean')
  );
};
const isWorkerInput = (v: unknown): v is WorkerInput => {
  const o = v as WorkerInput;
  return (
    !!o && str(o.name, 40) && o.name.trim().length > 0 && ROLE_IDS.has(o.role) && str(o.title, 60) && idOrNull(o.reportsTo) &&
    (o.profile === undefined || isProfile(o.profile))
  );
};
const hasStatus = <T extends object>(v: T): v is T & { status: TaskStatus } => STATUSES.has((v as { status?: TaskStatus }).status!);
const isLookPatch = (v: unknown): v is Partial<Look> =>
  !!v && typeof v === 'object' && Object.entries(v).every(([k, x]) => k in DEFAULT_LOOK && (x === null || str(x, 40)));
const isAiPatch = (v: unknown): v is Partial<WorkerAi> => {
  const o = v as Partial<WorkerAi>;
  if (!o || typeof o !== 'object') return false;
  if ('sharedKey' in o && typeof o.sharedKey !== 'boolean') return false;
  if ('provider' in o && o.provider !== null && !isProvider(o.provider)) return false;
  // A short model id; which ones a provider takes is checked when the agent thinks.
  if ('model' in o && o.model !== null && !(str(o.model, 80) && /^[\w.:/-]+$/.test(o.model))) return false;
  if ('mcps' in o && !(Array.isArray(o.mcps) && o.mcps.length <= 40 && o.mcps.every((m) => str(m, 24) && /^[a-z0-9_]+$/.test(m)))) return false;
  return true;
};
/** Only what the browser may set, tidied. */
const clean = (w: WorkerInput): WorkerInput => ({
  name: w.name.trim(),
  role: w.role,
  title: w.title.trim(),
  reportsTo: w.reportsTo,
  ...(w.profile ? { profile: cleanProfile(w.profile) } : {}),
});

/**
 * Everything the browser may ask the server to do, by name. Each entry checks its own
 * arguments: they arrive as untrusted JSON. A string result is a refusal to show the person.
 */
export const COMMANDS = {
  setWorking: (on: unknown) => typeof on === 'boolean' && setWorking(on),
  setOfficeInfo: (agency: unknown, project: unknown) => str(agency, 60) && str(project, 80) && setOfficeInfo(agency.trim(), project.trim()),
  addWorker: (input: unknown) => (isWorkerInput(input) ? addWorker(clean(input)) : null),
  updateWorker: (id: unknown, input: unknown) => (str(id, 64) && isWorkerInput(input) ? updateWorker(id, clean(input)) : null),
  setProfile: (id: unknown, profile: unknown) => str(id, 64) && (profile === null || isProfile(profile)) && void setProfile(id, profile === null ? null : cleanProfile(profile)),
  setBoss: (id: unknown, bossId: unknown) => (str(id, 64) && str(bossId, 64) ? setBoss(id, bossId) : null),
  removeWorker: (id: unknown) => (str(id, 64) ? removeWorker(id) : null),
  callSkeptic: () => callSkeptic(),
  setWorkerAi: (id: unknown, patch: unknown) => str(id, 64) && isAiPatch(patch) && setWorkerAi(id, patch),
  setEnabled: (id: unknown, on: unknown) => str(id, 64) && typeof on === 'boolean' && setEnabled(id, on),
  setPair: (id: unknown, partner: unknown) => str(id, 64) && idOrNull(partner) && setPair(id, partner),
  setDesk: (id: unknown, slot: unknown) => str(id, 64) && Number.isInteger(slot) && setDesk(id, slot as number),
  updateLook: (id: unknown, patch: unknown) => str(id, 64) && isLookPatch(patch) && updateLook(id, patch),
  assignTask: (taskId: unknown, workerId: unknown) => str(taskId, 64) && idOrNull(workerId) && assignTask(taskId, workerId),
  placeTask: (taskId: unknown, workerId: unknown, order: unknown) =>
    str(taskId, 64) && idOrNull(workerId) && Array.isArray(order) && order.length <= 200 && order.every((x) => str(x, 64)) && void placeTask(taskId, workerId, order as string[]),
  requestWork: (text: unknown, via: unknown) =>
    typeof text === 'string' && text.trim().length >= 3 && text.length <= 2000 && (via === undefined || via === null || str(via, 64)) && void requestWork(text.trim(), (via as string) ?? null),
  clearConversations: () => clearConversations(),
  callMeeting: () => callMeeting('review'),
  ownerSay: (text: unknown) => typeof text === 'string' && text.trim().length >= 1 && text.length <= 4000 && void ownerSay(text.trim()),
  ownerChat: (id: unknown, text: unknown, files: unknown) =>
    str(id, 64) &&
    typeof text === 'string' &&
    text.length <= 2_000_000 &&
    (files === undefined || (Array.isArray(files) && files.length <= 10 && files.every((f) => str(f, 40)))) &&
    void ownerChat(id, text.trim(), (files as string[] | undefined) ?? []),
  endMeeting: () => endMeeting(),
  ownerTalk: (id: unknown, text: unknown) => str(id, 64) && typeof text === 'string' && text.trim().length >= 1 && text.length <= 4000 ? ownerTalk(id, text.trim()) : null,
  resetChat: (id: unknown) => str(id, 64) && void resetChat(id),
  readChat: (id: unknown) => str(id, 64) && void readChat(id),
  deleteChatArchive: (id: unknown, at: unknown) => str(id, 64) && typeof at === 'number' && Number.isFinite(at) && void deleteChatArchive(id, at),
  answerQuestion: (id: unknown, text: unknown) => str(id, 24) && typeof text === 'string' && text.trim().length >= 1 && text.length <= 4000 && void answerQuestion(id, text.trim()),
  createTask: (input: unknown) => isTaskInput(input) && void createTask({ ...input, title: input.title.trim() }),
  updateTask: (id: unknown, patch: unknown) =>
    str(id, 64) && isTaskInput(patch) && hasStatus(patch) && updateTask(id, { ...patch, title: patch.title.trim() }),
  deleteTask: (id: unknown) => str(id, 64) && deleteTask(id),
  setStatus: (id: unknown, status: unknown) => str(id, 64) && STATUSES.has(status as TaskStatus) && setStatus(id, status as TaskStatus),
  readMessages: (ids: unknown) => (ids === 'all' || (Array.isArray(ids) && ids.length <= 120 && ids.every((x) => str(x, 24)))) && readMessages(ids as string[] | 'all'),
  closeMessage: (id: unknown) => str(id, 24) && closeMessage(id),
  askHireIdeas: (force: unknown) => askHireIdeas(force === true),
  addEvent: (input: unknown) => isEventInput(input) && void addEvent(input),
  updateEvent: (id: unknown, input: unknown) => str(id, 24) && isEventInput(input) && updateEvent(id, input),
  deleteEvent: (id: unknown) => str(id, 24) && deleteEvent(id),
  reset: () => reset(),
} satisfies Record<string, (...args: unknown[]) => unknown>;

export type CommandName = keyof typeof COMMANDS;
