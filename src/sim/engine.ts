import { BLOCK_REASONS, DAY_END, DAY_START, MINUTES_PER_DAY, TASK_POOL } from './seed';
import {
  block,
  complete,
  createTask,
  dayOf,
  getState,
  log,
  notify,
  save,
  sendCoffee,
  sendToReview,
  startTask,
  task,
  unblock,
} from './store';
import type { Activity, Task, Worker } from './types';

/** Sim minutes that pass per real second at 1×. */
export const SIM_MINUTES_PER_SECOND = 5;
const MEETING_START = 9 * 60 + 30;
const MEETING_END = 10 * 60;
const REVIEW_MINUTES = 45;
const IDLE_BEFORE_NEW_WORK = 40;

let saveTimer = 0;
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function update(dtReal: number): void {
  const s = getState();
  if (s.speed === 0) return;
  let dt = Math.min(dtReal, 0.25) * SIM_MINUTES_PER_SECOND * s.speed;
  // Small fixed-ish steps keep per-minute probabilities stable at 16×.
  while (dt > 0) {
    const step = Math.min(dt, 2);
    step_(step);
    dt -= step;
  }
  notify('tick');
  saveTimer += dtReal;
  if (saveTimer > 3) {
    saveTimer = 0;
    save();
  }
}

function step_(dt: number): void {
  const s = getState();
  s.clock += dt;

  if (s.clock % MINUTES_PER_DAY >= DAY_END) {
    s.clock = (dayOf(s.clock) + 1) * MINUTES_PER_DAY + DAY_START;
    for (const w of s.workers) {
      w.energy = 100;
      w.coffeeUntil = null;
    }
    log('day', `Empieza el día ${dayOf(s.clock)}`);
    notify('change');
  }

  const day = dayOf(s.clock);
  const minute = s.clock % MINUTES_PER_DAY;
  const inMeeting = minute >= MEETING_START && minute < MEETING_END;
  if (inMeeting && s.lastMeetingDay !== day) {
    s.lastMeetingDay = day;
    log('meeting', 'Daily de las 9:30 en la mesa grande');
    notify('change');
  }

  for (const w of s.workers) stepWorker(w, dt, inMeeting, minute);
}

function stepWorker(w: Worker, dt: number, inMeeting: boolean, minute: number): void {
  const s = getState();
  let t = task(w.taskId);

  if (t?.status === 'blocked' && t.blockedUntil !== null && s.clock >= t.blockedUntil) {
    unblock(t);
  }
  if (w.coffeeUntil !== null && s.clock >= w.coffeeUntil) {
    w.coffeeUntil = null;
    notify('change');
  }

  const reviewQueue = w.role === 'qa' ? oldestInReview() : undefined;

  let activity: Activity;
  if (inMeeting) activity = 'meeting';
  else if (w.coffeeUntil !== null) activity = 'coffee';
  else if (reviewQueue) activity = 'reviewing';
  else if (t?.status === 'blocked') activity = 'blocked';
  else if (t?.status === 'doing') activity = w.pairWith ? 'pairing' : 'working';
  else activity = 'idle';

  if (activity !== w.activity) {
    w.activity = activity;
    if (activity === 'idle') w.idleSince = s.clock;
    notify('change');
  }

  const efficiency = 0.55 + 0.45 * (w.energy / 100);

  switch (activity) {
    case 'coffee':
      w.energy = Math.min(100, w.energy + dt * 3);
      return;
    case 'meeting':
    case 'blocked':
      return;
    case 'reviewing': {
      const r = reviewQueue!;
      w.energy = Math.max(0, w.energy - dt * 0.15);
      r.reviewProgress += (dt / REVIEW_MINUTES) * 100 * efficiency;
      if (r.reviewProgress >= 100) {
        if (Math.random() < 0.12) {
          r.status = 'backlog';
          r.progress = 85;
          r.reviewProgress = 0;
          r.assigneeId = null;
          log('review', `${w.name} devuelve «${r.title}» con cambios`, w.id, r.id);
        } else {
          complete(r, `${w.name} aprueba «${r.title}»`, w.id);
        }
        notify('change');
      }
      maybeCoffee(w, minute);
      return;
    }
    case 'working':
    case 'pairing': {
      t = t!;
      w.energy = Math.max(0, w.energy - dt * 0.18);
      const paired = activity === 'pairing' || s.workers.some((o) => o.pairWith === w.id && o.activity === 'pairing');
      t.progress += (dt / (t.estimate * 60)) * 100 * efficiency * (paired ? 1.25 : 1);
      if (t.progress >= 100) {
        if (t.role === 'qa' || t.role === 'pm') complete(t);
        else sendToReview(t);
        notify('change');
        return;
      }
      if (Math.random() < dt * 0.0011) {
        block(t, pick(BLOCK_REASONS), 30 + Math.random() * 90);
        notify('change');
        return;
      }
      maybeCoffee(w, minute);
      return;
    }
    case 'idle':
      findWork(w);
      return;
  }
}

function maybeCoffee(w: Worker, minute: number): void {
  if (minute > DAY_END - 30) return;
  if (w.energy < 38 || Math.random() < 0.0004) sendCoffee(w.id, 12 + Math.random() * 12);
}

function oldestInReview(): Task | undefined {
  return getState()
    .tasks.filter((t) => t.status === 'review')
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

function findWork(w: Worker): void {
  const s = getState();
  const next = s.tasks
    .filter((t) => t.status === 'backlog' && !t.assigneeId && t.role === w.role)
    .sort((a, b) => b.progress - a.progress || a.createdAt - b.createdAt)[0];
  if (next) {
    startTask(w, next);
    notify('change');
    return;
  }
  if (w.idleSince !== null && s.clock - w.idleSince > IDLE_BEFORE_NEW_WORK) {
    const titles = TASK_POOL[w.role];
    const used = new Set(s.tasks.map((t) => t.title));
    const title = titles.find((x) => !used.has(x)) ?? `${pick(titles)} (v${s.nextId % 10})`;
    createTask({ title, role: w.role, estimate: Math.round(3 + Math.random() * 6), assigneeId: w.id });
  }
}
