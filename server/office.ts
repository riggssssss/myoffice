/** Hosts the office: loads it, applies changes, saves it and tells the browsers. */
import { COMMANDS, ensureRequired, getState, refreshActivities, setNotifier, setState, type ChangeKind, type CommandName } from '../src/sim/ops';
import { SCHEMA_VERSION } from '../src/sim/seed';
import type { SimState } from '../src/sim/types';
import { agentKey, PROVIDERS, type TextProvider } from '../src/sim/settings';
import { getJson, setJson } from './db';
import { deleteSecret } from './vault';
import { startAgents } from './agents';

/** The first state version the local server saved (before it, the office lived in the browser). */
const FIRST_REAL_VERSION = 6;

let pending: ChangeKind | null = null;
let broadcast: (kind: ChangeKind, state: SimState) => void = () => {};

export function startOffice(onBroadcast: typeof broadcast): () => void {
  broadcast = onBroadcast;
  const saved = getJson<SimState>('state');
  // Everything since the office moved to this server is kept and brought up to date (new fields
  // are filled in by ensureRequired). Only saves from the simulated era, whose data was made
  // up, are left behind. A copy of the old save stays aside before any upgrade.
  if (saved && saved.version >= FIRST_REAL_VERSION && Array.isArray(saved.workers)) {
    if (saved.version !== SCHEMA_VERSION) setJson(`state:backup:v${saved.version}`, saved);
    saved.version = SCHEMA_VERSION;
    setState(saved);
  }
  setNotifier((kind) => {
    if (pending !== 'change') pending = kind;
  });
  ensureRequired();
  refreshActivities();
  save();
  // Timed things (the sceptic's visit ending) are checked now and then; nothing else moves on its own.
  const timer = setInterval(() => {
    getState().clock = Date.now();
    refreshActivities();
    publish();
  }, 5000);
  const stopAgents = startAgents(publish);
  return () => {
    clearInterval(timer);
    stopAgents();
    save();
  };
}

function publish(): void {
  if (!pending) return;
  const kind = pending;
  pending = null;
  save();
  broadcast(kind, getState());
}

function save(): void {
  setJson('state', getState());
}

export function snapshot(): SimState {
  return getState();
}

/**
 * Runs a command from a browser. Unknown names and bad arguments are ignored; a refusal
 * (e.g. a loop in the org chart) comes back as text for that browser to show.
 */
export function runCommand(name: unknown, args: unknown): string | null {
  if (typeof name !== 'string' || !Object.hasOwn(COMMANDS, name) || !Array.isArray(args) || args.length > 4) return null;
  getState().clock = Date.now();
  const result = (COMMANDS[name as CommandName] as (...a: unknown[]) => unknown)(...args);
  // Someone who left takes their own AI keys with them.
  if (name === 'removeWorker' && typeof args[0] === 'string' && !getState().workers.some((w) => w.id === args[0])) {
    for (const p of Object.keys(PROVIDERS) as TextProvider[]) deleteSecret(agentKey(args[0], p));
  }
  refreshActivities();
  publish();
  return typeof result === 'string' ? result : null;
}
