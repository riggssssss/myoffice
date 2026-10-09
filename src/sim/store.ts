/**
 * The browser's copy of the office. The local server owns the real state (src/sim/ops.ts runs
 * there); this keeps the last snapshot it sent, tells the UI when it changed, and forwards
 * every action to the server by name.
 */
import { DEFAULT_LOOK, type Look } from './look';
import type { ChangeKind, CommandName, EventInput, TaskInput, WorkerInput } from './ops';
import type { WorkerAi } from './settings';
import type { AgentProfile, ChatFile, SimState, Task, TaskStatus, Worker } from './types';

export type { ChangeKind } from './ops';
type Listener = (kind: ChangeKind) => void;

let state: SimState;
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

// ---------- lookups ----------

export const worker = (id: string | null): Worker | undefined =>
  id ? state.workers.find((w) => w.id === id) : undefined;

export const task = (id: string | null): Task | undefined =>
  id ? state.tasks.find((t) => t.id === id) : undefined;

// ---------- connection ----------

let socket: WebSocket | null = null;
let token = '';
let onStatus: (online: boolean) => void = () => {};
let onRefused: (text: string) => void = () => {};

/** The server said no to something (e.g. a loop in the org chart): show why. */
export function onRefusal(fn: (text: string) => void): void {
  onRefused = fn;
}

/** Called with false while the local server is unreachable, true once it's back. */
export function onConnection(fn: (online: boolean) => void): void {
  onStatus = fn;
}

/**
 * The scene rebuilds a figure when its look object changes identity: keep the old object
 * whenever the snapshot's look is the same.
 */
function adopt(next: SimState): void {
  if (state) {
    for (const w of next.workers) {
      const prev = state.workers.find((o) => o.id === w.id);
      if (prev && JSON.stringify(prev.look) === JSON.stringify(w.look)) w.look = prev.look;
    }
  }
  state = next;
  if (selectedId && !worker(selectedId)) selectedId = null;
}

async function session(): Promise<string> {
  const res = await fetch('/api/session', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`session ${res.status}`);
  token = ((await res.json()) as { token: string }).token;
  return token;
}

/** A JSON call to the local server, with this session's token. */
export async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-oficina-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // The server's reason, when it gives one in Spanish for the panel to show.
  if (!res.ok) throw new Error((await res.json().then((b: { error?: string }) => b.error).catch(() => null)) ?? `${method} ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Sends a file for the chat; the server keeps it and says what it is. */
export async function upload(file: File, onProgress?: (part: number) => void, palette?: { hex: string; share: number }[]): Promise<ChatFile> {
  // XHR rather than fetch: it reports how far the upload has gone.
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/files');
    x.setRequestHeader('x-oficina-token', token);
    x.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    // A picture's measured colours, in case it becomes a style reference.
    if (palette?.length) x.setRequestHeader('x-file-palette', encodeURIComponent(JSON.stringify(palette)));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let body: (ChatFile & { error?: string }) | null = null;
      try {
        body = JSON.parse(x.responseText);
      } catch {
        /* reported below */
      }
      if (x.status === 200 && body) resolve(body);
      else reject(new Error(body?.error ?? 'No se pudo subir'));
    };
    x.onerror = () => reject(new Error('No se pudo subir: ¿está en marcha el servidor local?'));
    x.send(file);
  });
}

/** A chat file for the page (fetched with the session's token, never put in an address). */
const blobs = new Map<string, Promise<string>>();
export function fileUrl(id: string): Promise<string> {
  let p = blobs.get(id);
  if (!p) {
    p = fetch(`/api/files/${id}`, { headers: { 'x-oficina-token': token } }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => blobs.delete(id));
    blobs.set(id, p);
  }
  return p;
}

/** Resolves with the first snapshot; reconnects on its own after that. */
export function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    let first = true;
    let retry = 500;
    const open = async () => {
      let token: string;
      try {
        token = await session();
      } catch (e) {
        if (first) return reject(e);
        setTimeout(open, (retry = Math.min(retry * 2, 8000)));
        return;
      }
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as
          | { type: 'state'; kind: ChangeKind; state: SimState }
          | { type: 'refused'; text: string }
          | { type: 'project' }
          | { type: 'refs' }
          | { type: 'linkedin' };
        if (msg.type === 'refused') return onRefused(msg.text);
        if (msg.type === 'project') return void document.dispatchEvent(new Event('project-changed'));
        if (msg.type === 'refs') return void document.dispatchEvent(new Event('refs-changed'));
        if (msg.type === 'linkedin') return void document.dispatchEvent(new Event('linkedin-changed'));
        if (msg.type !== 'state') return;
        adopt(msg.state);
        notify(msg.kind);
        retry = 500;
        if (first) {
          first = false;
          resolve();
        } else onStatus(true);
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        if (first) return reject(new Error('closed before the first snapshot'));
        onStatus(false);
        setTimeout(open, (retry = Math.min(retry * 2, 8000)));
      };
      socket = ws;
    };
    void open();
  });
}

function send(name: CommandName, ...args: unknown[]): void {
  socket?.send(JSON.stringify({ type: 'cmd', name, args }));
}

// ---------- actions (run on the server) ----------

export function select(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  notify('change');
}

export const setWorking = (on: boolean) => send('setWorking', on);
export const setOfficeInfo = (agency: string, project: string) => send('setOfficeInfo', agency, project);
export const addWorker = (input: WorkerInput) => send('addWorker', input);
export const updateWorker = (id: string, input: WorkerInput) => send('updateWorker', id, input);
export const setProfile = (id: string, profile: AgentProfile | null) => send('setProfile', id, profile);
export const ownerTalk = (convId: string, text: string) => send('ownerTalk', convId, text);
export const setBoss = (id: string, bossId: string) => send('setBoss', id, bossId);
export const callSkeptic = () => send('callSkeptic');
export const setWorkerAi = (id: string, patch: Partial<WorkerAi>) => send('setWorkerAi', id, patch);
export const removeWorker = (id: string) => send('removeWorker', id);
export const setEnabled = (workerId: string, on: boolean) => send('setEnabled', workerId, on);
export const assignTask = (taskId: string, workerId: string | null) => send('assignTask', taskId, workerId);
export const createTask = (input: TaskInput) => send('createTask', input);
export const requestWork = (text: string, via: string | null = null) => send('requestWork', text, via);
export const answerQuestion = (id: string, text: string) => send('answerQuestion', id, text);
export const clearConversations = () => send('clearConversations');
export const callMeeting = () => send('callMeeting');
export const ownerSay = (text: string) => send('ownerSay', text);
export const ownerChat = (workerId: string, text: string, files: string[] = []) => send('ownerChat', workerId, text, files);
export const resetChat = (workerId: string) => send('resetChat', workerId);
export const readChat = (workerId: string) => send('readChat', workerId);
export const placeTask = (taskId: string, workerId: string | null, order: string[]) => send('placeTask', taskId, workerId, order);
export const deleteChatArchive = (workerId: string, at: number) => send('deleteChatArchive', workerId, at);
export const endMeeting = () => send('endMeeting');
export const updateTask = (id: string, patch: TaskInput & { status: TaskStatus }) => send('updateTask', id, patch);
export const deleteTask = (id: string) => send('deleteTask', id);
export const setStatus = (id: string, status: TaskStatus) => send('setStatus', id, status);
export const setPair = (workerId: string, partnerId: string | null) => send('setPair', workerId, partnerId);
export const setDesk = (workerId: string, slot: number) => send('setDesk', workerId, slot);
export const reset = () => send('reset');
export const addEvent = (input: EventInput) => send('addEvent', input);
export const updateEvent = (id: string, input: EventInput) => send('updateEvent', id, input);
export const deleteEvent = (id: string) => send('deleteEvent', id);
/** Applied here at once too, so a seen message stops popping up straight away. */
export function readMessages(ids: string[] | 'all'): void {
  for (const m of state.inbox) if (!m.read && (ids === 'all' || ids.includes(m.id))) m.read = true;
  notify('change');
  send('readMessages', ids);
}
export function closeMessage(id: string): void {
  const m = state.inbox.find((x) => x.id === id);
  if (m) Object.assign(m, { closed: true, read: true });
  notify('change');
  send('closeMessage', id);
}
/** Ask the head who your project needs (`force`: even if nothing changed since last time). */
export const askHireIdeas = (force = false) => send('askHireIdeas', force);
/** Applied here at once too, so the «new» badge goes as soon as you look. */
export function seeItems(ids: string[] | 'all'): void {
  for (const i of state.items) if (i.unseen && (ids === 'all' || ids.includes(i.id))) i.unseen = false;
  notify('change');
  send('seeItems', ids);
}
export const starItem = (id: string, on: boolean) => send('starItem', id, on);
export const archiveItem = (id: string, on: boolean) => send('archiveItem', id, on);
export const askItemChanges = (id: string, text: string) => send('askItemChanges', id, text);

/** Applied here at once too: the appearance editor previews from local state. */
export function updateLook(workerId: string, patch: Partial<Look>): void {
  const w = worker(workerId);
  if (!w) return;
  const next = { ...DEFAULT_LOOK, ...w.look, ...patch };
  if (next.top !== 'hoodie' && next.headwear === 'hood') next.headwear = 'none';
  w.look = next;
  notify('change');
  send('updateLook', workerId, patch);
}
