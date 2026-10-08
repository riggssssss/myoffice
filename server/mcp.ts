/**
 * Your connector library: MCP servers any agent can reuse. Stored in the database with
 * `${secret:…}` references only; the values live in the vault.
 */
import { MCP_PRESETS, mcpSecret, type McpServer } from '../src/sim/settings';
import { getJson, setJson } from './db';
import { deleteSecret, listSecrets } from './vault';

const ID = /^[a-z0-9_]{1,24}$/;
const ENV = /^[A-Z][A-Z0-9_]{0,63}$/;
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const REF = /^(?:[^$]|\$(?!\{))*\$\{secret:([a-z0-9_]{1,64})\}(?:[^$]|\$(?!\{))*$/;

export function listMcp(): McpServer[] {
  return getJson<McpServer[]>('mcp') ?? [];
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Values must be plain text without secrets in them, or exactly one vault reference. */
function cleanMap(v: unknown, keyOk: RegExp): Record<string, string> | null {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!keyOk.test(k) || !str(x, 300)) return null;
    if (x.includes('${') && !REF.test(x)) return null;
    out[k] = x;
  }
  return out;
}

/** Adds or replaces a connector; returns a reason when it isn't valid. */
export function putMcp(input: unknown): string | null {
  const o = input as Partial<McpServer>;
  if (!o || !str(o.id, 24) || !ID.test(o.id)) return 'Identificador no válido';
  if (!str(o.name, 60) || !o.name.trim()) return 'Ponle un nombre';
  if (o.preset !== null && !MCP_PRESETS.some((p) => p.id === o.preset)) return 'Plantilla desconocida';
  const env = cleanMap(o.env, ENV);
  const headers = cleanMap(o.headers, HEADER);
  if (!env || !headers) return 'Variables no válidas';
  let server: McpServer;
  if (o.transport === 'http') {
    if (!str(o.url, 300)) return 'Falta la dirección';
    try {
      const u = new URL(o.url);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) {
        return 'Usa https (o http solo en tu propio ordenador)';
      }
    } catch {
      return 'Dirección no válida';
    }
    server = { id: o.id, name: o.name.trim(), preset: o.preset ?? null, transport: 'http', command: '', args: [], url: o.url, env: {}, headers };
  } else if (o.transport === 'stdio') {
    if (!str(o.command, 120) || !o.command.trim()) return 'Falta el comando';
    if (!Array.isArray(o.args) || o.args.length > 30 || !o.args.every((a) => str(a, 300))) return 'Argumentos no válidos';
    server = { id: o.id, name: o.name.trim(), preset: o.preset ?? null, transport: 'stdio', command: o.command.trim(), args: o.args, url: '', env, headers: {} };
  } else return 'Tipo de conector no válido';
  const all = listMcp().filter((s) => s.id !== server.id);
  setJson('mcp', [...all, server]);
  return null;
}

/** Removes a connector and every value of its in the vault. */
export function deleteMcp(id: string): void {
  setJson(
    'mcp',
    listMcp().filter((s) => s.id !== id),
  );
  const prefix = mcpSecret(id, '');
  for (const s of listSecrets()) if (s.name.startsWith(prefix)) deleteSecret(s.name);
}
