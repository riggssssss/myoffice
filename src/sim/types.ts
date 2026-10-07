import type { Look } from './look';

export type RoleId = 'research' | 'design' | 'backend' | 'pm' | 'qa';

export type TaskStatus = 'backlog' | 'doing' | 'blocked' | 'review' | 'done';

export type Activity =
  | 'working'
  | 'pairing'
  | 'reviewing'
  | 'meeting'
  | 'coffee'
  | 'blocked'
  | 'idle';

export interface Worker {
  id: string;
  name: string;
  title: string;
  role: RoleId;
  desk: number;
  look: Look;
  energy: number;
  activity: Activity;
  taskId: string | null;
  /** Worker sits at this partner's desk and both get a boost. */
  pairWith: string | null;
  /** Sim minute (absolute) until which a coffee break lasts. */
  coffeeUntil: number | null;
  idleSince: number | null;
}

export interface Task {
  id: string;
  title: string;
  role: RoleId;
  assigneeId: string | null;
  status: TaskStatus;
  progress: number;
  reviewProgress: number;
  estimate: number;
  createdAt: number;
  doneAt: number | null;
  blockedUntil: number | null;
  blockReason: string | null;
}

export type FeedKind =
  | 'start'
  | 'done'
  | 'review'
  | 'blocked'
  | 'unblocked'
  | 'pair'
  | 'unpair'
  | 'coffee'
  | 'meeting'
  | 'create'
  | 'edit'
  | 'day';

export interface FeedEvent {
  id: number;
  /** Absolute sim minute. */
  t: number;
  kind: FeedKind;
  text: string;
  workerId: string | null;
  taskId: string | null;
}

export type Speed = 0 | 1 | 4 | 16;

export interface SimState {
  version: number;
  agency: string;
  project: string;
  /** Absolute sim minutes since day 1 00:00. */
  clock: number;
  speed: Speed;
  lastMeetingDay: number;
  workers: Worker[];
  tasks: Task[];
  feed: FeedEvent[];
  nextId: number;
}

export interface RoleInfo {
  id: RoleId;
  label: string;
  color: string;
}
