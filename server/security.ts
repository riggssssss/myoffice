/**
 * Who may talk to the local server: only this app's own pages on this machine.
 *
 * - Loopback-only listening keeps the network out.
 * - Host checks stop DNS rebinding (an evil site whose name resolves to 127.0.0.1).
 * - Origin checks stop any other web page open in the browser (WebSockets ignore CORS).
 * - A per-start token, handed only to same-origin pages, guards every change.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const PORT = Number(process.env.OFICINA_PORT ?? 8787);
/** Vite's dev server (strictPort), which proxies /api and /ws here. */
export const DEV_PORT = Number(process.env.OFICINA_DEV_PORT ?? 5173);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const PORTS = new Set([String(PORT), String(DEV_PORT)]);

export const TOKEN = randomBytes(32).toString('base64url');

function loopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(host);
  return !!m && LOOPBACK.has(m[1].toLowerCase()) && PORTS.has(m[2]);
}

/** Host must be ours; Origin, when the browser sends one, too. */
export function trustedRequest(req: IncomingMessage): boolean {
  if (!loopbackHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && loopbackHost(u.host);
  } catch {
    return false;
  }
}

export function validToken(given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
