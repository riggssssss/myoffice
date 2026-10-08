/**
 * What an agent wants to do outside that needs your yes: in one of your apps (Composio) or
 * through one of your connectors (MCP). One queue, one message each in «Para ti» with «Aprobar» or
 * «Descartar»; approving runs it there and then, and the agent hears how it went.
 */
import { randomBytes } from 'node:crypto';
import type { AppAction } from '../src/sim/apps';
import { getState, log, notify, tellOwner, worker } from '../src/sim/ops';
import type { Worker } from '../src/sim/types';
import { getJson, setJson } from './db';
import { redact } from './vault';

type Runner = (a: AppAction) => Promise<string>;
const runners = new Map<AppAction['via'], Runner>();
/** Composio and the connector host each say how to carry out one of theirs. */
export const registerRunner = (via: AppAction['via'], run: Runner) => runners.set(via, run);

/** Notes go into the agent's own notebook (set by agents.ts, to avoid a loop between modules). */
let remember: (w: Worker, text: string) => void = () => undefined;
export const setRemember = (fn: (w: Worker, text: string) => void) => (remember = fn);

const actions = () => getJson<AppAction[]>('apps:actions') ?? [];
const save = (a: AppAction) => setJson('apps:actions', [a, ...actions().filter((x) => x.id !== a.id)].slice(0, 100));
export const getAction = (id: string) => actions().find((a) => a.id === id) ?? null;

export function propose(me: Worker, via: AppAction['via'], app: string, appName: string, tool: string, args: Record<string, unknown>, why: string): AppAction {
  const a: AppAction = { id: `a${randomBytes(5).toString('hex')}`, at: Date.now(), by: me.id, byName: me.name, via, app, tool, why, args, status: 'open', result: null };
  save(a);
  const shown = redact(JSON.stringify(args, null, 1)).slice(0, 700);
  tellOwner(me.id, 'app', `Quiere usar ${appName}: ${why}`, `${tool}\n${shown}`, { type: 'app', actionId: a.id });
  return a;
}

/** You approve or turn down an agent's action. */
export async function actOnAction(id: string, action: unknown): Promise<string | null> {
  const a = getAction(id);
  if (!a) return 'Esa acción ya no existe';
  if (a.status !== 'open' && !(a.status === 'failed' && action === 'approve')) return 'Esa acción ya no está pendiente';
  const close = () => {
    const m = getState().inbox.find((x) => x.action?.type === 'app' && x.action.actionId === id);
    if (m) m.closed = true;
    notify('change');
  };
  const who = worker(a.by);
  if (action === 'reject') {
    a.status = 'rejected';
    save(a);
    close();
    if (who) remember(who, `El propietario no aprobó usar ${a.tool} en ${a.app} (${a.why}).`);
    return null;
  }
  if (action !== 'approve') return 'Acción no válida';
  const run = runners.get(a.via);
  try {
    if (!run) throw new Error('Esa conexión ya no está disponible');
    a.result = await run(a);
    a.status = a.result.startsWith('No salió') ? 'failed' : 'done';
  } catch (e) {
    a.status = 'failed';
    a.result = redact(e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  save(a);
  if (a.status === 'done') close();
  log('office', `${a.status === 'done' ? 'Aprobaste' : 'Falló'}: ${a.byName} · ${a.tool} en ${a.app}`, a.by);
  if (who) remember(who, `${a.status === 'done' ? 'Hecho con aprobación del propietario' : 'Falló'}: ${a.tool} en ${a.app} (${a.why}). Resultado: ${(a.result ?? '').slice(0, 200)}`);
  return a.status === 'failed' ? a.result : null;
}

/** Last time each agent read something from outside (a web, an app, a connector): writing waits for you after it. */
const tainted = new Map<string, number>();
const TAINT_MS = 30 * 60_000;
export const markTainted = (workerId: string) => tainted.set(workerId, Date.now());
export const isTainted = (workerId: string) => Date.now() - (tainted.get(workerId) ?? 0) < TAINT_MS;

/** What a tool's name says it does: only clearly read-only ones count as reading. */
const READS = /(^|[_.-])(get|list|fetch|search|find|read|retrieve|query|download|export|count|check|view|describe|lookup|info|crawl|scrape|extract|map)([_.-]|$)/i;
const WRITES = /(^|[_.-])(send|create|post|update|delete|remove|add|upload|publish|reply|share|invite|move|archive|patch|put|set|modify|edit|insert|write|schedule|cancel|approve|mark|star|like|follow|comment|merge|close|trigger|run|execute|start|stop|forward|transfer|pay|charge|refund|submit|vote)([_.-]|$)/i;
export function readsOnly(name: string, hints: { readOnly?: boolean; destructive?: boolean } = {}): boolean {
  if (hints.destructive) return false;
  if (hints.readOnly) return true;
  return READS.test(name) && !WRITES.test(name);
}
