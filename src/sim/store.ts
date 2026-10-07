import { DEFAULT_LOOK, SEED_LOOKS, type Look } from './look';
import { createSeed, SCHEMA_VERSION, MINUTES_PER_DAY } from './seed';
import type { FeedKind, RoleId, SimState, Speed, Task, TaskStatus, Worker } from './types';

const STORAGE_KEY = 'oficina-3d:state';
const FEED_LIMIT = 250;

/** 'tick' = numbers moved; 'change' = structure changed (status, assignment, selection…). */
export type ChangeKind = 'tick' | 'change';
type Listener = (kind: ChangeKind) => void;

const REMOVED_WORKER = 'tu';

/** Old saves: v2 had a camera worker (removed in v3); before v4 workers had only skin + hair colours. */
function migrate(s: SimState): void {
  const gone = new Set(s.tasks.filter((t) => (t.role as string) === 'lead').map((t) => t.id));
  s.tasks = s.tasks.filter((t) => !gone.has(t.id));
  s.workers = s.workers.filter((w) => w.id !== REMOVED_WORKER);
  for (const t of s.tasks) if (t.assigneeId === REMOVED_WORKER) Object.assign(t, { assigneeId: null, status: 'backlog' });
  for (const w of s.workers) if (w.pairWith === REMOVED_WORKER) w.pairWith = null;
  s.feed = s.feed.filter((e) => e.workerId !== REMOVED_WORKER && !(e.taskId && gone.has(e.taskId)));
  for (const w of s.workers) {
    const legacy = w as Worker & { skin?: string; hair?: string };
    if (!w.look) w.look = { ...(SEED_LOOKS[w.id] ?? DEFAULT_LOOK) };
    // v5: Totoro became the default figure.
    if (!w.look.model) w.look.model = 'totoro';
    delete legacy.skin;
    delete legacy.hair;
  }
  s.version = SCHEMA_VERSION;
}

function load(): SimState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SimState;
      if (parsed.version < SCHEMA_VERSION && Array.isArray(parsed.workers)) migrate(parsed);
      if (parsed.version === SCHEMA_VERSION && Array.isArray(parsed.workers)) return parsed;
    }
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return createSeed();
}

let state: SimState = load();
let selectedId: string | null = null;
const listeners = new Set<Listener>();
let pending: ChangeKind | null = null;

export function getState(): SimState {
  return state;
}

export function getSelectedId(): string | null {
  return selectedId;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Queue a notification; flushed once per frame by the main loop. */
export function notify(kind: ChangeKind): void {
  if (pending === 'change') return;
  pending = kind;
}

export function flush(): void {
  if (!pending) return;
  const kind = pending;
  pending = null;
  for (const fn of listeners) fn(kind);
}

export function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota: simulation keeps running in memory */
  }
}

// ---------- lookups ----------

export const worker = (id: string | null): Worker | undefined =>
  id ? state.workers.find((w) => w.id === id) : undefined;

export const task = (id: string | null): Task | undefined =>
  id ? state.tasks.find((t) => t.id === id) : undefined;

export const dayOf = (clock: number) => Math.floor(clock / MINUTES_PER_DAY);

export function formatClock(clock: number): string {
  const m = clock % MINUTES_PER_DAY;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(Math.floor(m % 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------- feed ----------


export function log(
  kind: FeedKind,
  text: string,
  workerId: string | null = null,
  taskId: string | null = null,
): void {
  state.feed.unshift({ id: state.nextId++, t: state.clock, kind, text, workerId, taskId });
  if (state.feed.length > FEED_LIMIT) state.feed.length = FEED_LIMIT;
}

// ---------- actions ----------

export function select(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  notify('change');
}

export function setSpeed(speed: Speed): void {
  state.speed = speed;
  notify('change');
  save();
}

/** Put a worker's current task back in the backlog (keeps its progress). */
function release(w: Worker): void {
  const current = task(w.taskId);
  if (current && (current.status === 'doing' || current.status === 'blocked')) {
    current.status = 'backlog';
    current.assigneeId = null;
    current.blockedUntil = null;
    current.blockReason = null;
  }
  w.taskId = null;
}

export function startTask(w: Worker, t: Task, quiet = false): void {
  if (w.taskId === t.id) return;
  release(w);
  const prev = worker(t.assigneeId);
  if (prev && prev.taskId === t.id) prev.taskId = null;
  t.assigneeId = w.id;
  t.status = t.blockedUntil ? 'blocked' : 'doing';
  w.taskId = t.id;
  w.idleSince = null;
  if (!quiet) log('start', `${w.name} empieza «${t.title}»`, w.id, t.id);
}

export function assignTask(taskId: string, workerId: string | null): void {
  const t = task(taskId);
  if (!t) return;
  if (!workerId) {
    const prev = worker(t.assigneeId);
    if (prev && prev.taskId === t.id) release(prev);
    else t.assigneeId = null;
    if (t.status === 'doing' || t.status === 'blocked') t.status = 'backlog';
  } else {
    const w = worker(workerId);
    if (!w) return;
    if (t.status === 'done' || t.status === 'review') {
      t.status = 'backlog';
      t.doneAt = null;
      t.reviewProgress = 0;
      if (t.progress >= 100) t.progress = 90;
    }
    startTask(w, t);
  }
  notify('change');
  save();
}

export function createTask(input: {
  title: string;
  role: RoleId;
  estimate: number;
  assigneeId: string | null;
}): Task {
  const t: Task = {
    id: `t${state.nextId++}`,
    title: input.title,
    role: input.role,
    assigneeId: null,
    status: 'backlog',
    progress: 0,
    reviewProgress: 0,
    estimate: input.estimate,
    createdAt: state.clock,
    doneAt: null,
    blockedUntil: null,
    blockReason: null,
  };
  state.tasks.push(t);
  log('create', `Nueva tarea «${t.title}»`, null, t.id);
  if (input.assigneeId) assignTask(t.id, input.assigneeId);
  notify('change');
  save();
  return t;
}

export function updateTask(
  id: string,
  patch: { title: string; role: RoleId; estimate: number; status: TaskStatus; assigneeId: string | null },
): void {
  const t = task(id);
  if (!t) return;
  t.title = patch.title;
  t.role = patch.role;
  t.estimate = patch.estimate;
  if (patch.assigneeId !== t.assigneeId) assignTask(id, patch.assigneeId);
  if (patch.status !== t.status) setStatus(id, patch.status);
  log('edit', `Tarea «${t.title}» actualizada`, null, t.id);
  notify('change');
  save();
}

export function setStatus(id: string, status: TaskStatus): void {
  const t = task(id);
  if (!t || t.status === status) return;
  const owner = worker(t.assigneeId);
  switch (status) {
    case 'blocked':
      block(t, 'Bloqueada manualmente', 120);
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
      break;
    case 'review':
      sendToReview(t);
      break;
    case 'done':
      complete(t);
      break;
  }
  notify('change');
  save();
}

export function block(t: Task, reason: string, minutes: number): void {
  t.status = 'blocked';
  t.blockedUntil = state.clock + minutes;
  t.blockReason = reason;
  const owner = worker(t.assigneeId);
  log('blocked', `${owner ? `${owner.name} tiene un bloqueo` : 'Bloqueo'} en «${t.title}»: ${reason.toLowerCase()}`, owner?.id ?? null, t.id);
}

export function unblock(t: Task): void {
  t.status = t.assigneeId ? 'doing' : 'backlog';
  t.blockedUntil = null;
  t.blockReason = null;
  const owner = worker(t.assigneeId);
  log('unblocked', `«${t.title}» desbloqueada`, owner?.id ?? null, t.id);
  notify('change');
  save();
}

function freeOwner(t: Task): void {
  const owner = worker(t.assigneeId);
  if (owner && owner.taskId === t.id) {
    owner.taskId = null;
    owner.idleSince = state.clock;
    if (owner.pairWith) {
      log('unpair', `${owner.name} termina y vuelve a su mesa`, owner.id, null);
      owner.pairWith = null;
    }
  }
}

export function sendToReview(t: Task): void {
  t.progress = 100;
  t.status = 'review';
  t.reviewProgress = 0;
  t.blockedUntil = null;
  t.blockReason = null;
  freeOwner(t);
  const owner = worker(t.assigneeId);
  log('review', `${owner?.name ?? 'Alguien'} envía «${t.title}» a revisión`, owner?.id ?? null, t.id);
}

export function complete(t: Task, text = `«${t.title}» terminada`, by: string | null = t.assigneeId): void {
  t.progress = 100;
  t.reviewProgress = 100;
  t.status = 'done';
  t.doneAt = state.clock;
  t.blockedUntil = null;
  t.blockReason = null;
  freeOwner(t);
  log('done', text, by, t.id);
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
  save();
}

export function sendCoffee(workerId: string, minutes = 20): void {
  const w = worker(workerId);
  if (!w || w.coffeeUntil) return;
  w.coffeeUntil = state.clock + minutes;
  log('coffee', `${w.name} se va a por un café`, w.id, null);
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
  save();
}

/** Replaces the look object, so the scene can spot the change by identity. */
export function updateLook(workerId: string, patch: Partial<Look>): void {
  const w = worker(workerId);
  if (!w) return;
  const next = { ...w.look, ...patch };
  // A hood only exists on a hoodie.
  if (next.top !== 'hoodie' && next.headwear === 'hood') next.headwear = 'none';
  w.look = next;
  notify('change');
  save();
}

export function reset(): void {
  state = createSeed();
  selectedId = null;
  notify('change');
  save();
}
