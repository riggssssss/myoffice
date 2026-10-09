/**
 * The office's local server. Listens on loopback only, owns the state, the vault and the
 * database, and talks to the browser over one WebSocket plus a few JSON routes.
 */
import { liveWeather } from './weather';
import { testKey } from './keytest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { closeDb, getJson, openDb, setJson } from './db';
import { mutate, runCommand, snapshot, startOffice } from './office';
import { applyTemplate } from '../src/sim/ops';
import type { TeamId } from '../src/sim/types';
import { DATA_DIR, ensureDataDir } from './paths';
import { PORT, TOKEN, trustedRequest, validToken } from './security';
import { deleteMcp, listMcp, putMcp } from './mcp';
import { forgetMcp, mcpStatus, setMcpAccess, testMcp } from './mcpHost';
import { fileBytes, fileHeaders, fileInfo, makeFile, MAX_FILE, saveFile } from './files';
import { draw, imageUsage } from './images';
import { draftAgent } from './agentDraft';
import { draftVoice, linkedinView, redoPlan, setLinkedInNotifier, setPlan, setVoice, startLinkedIn } from './linkedin';
import { humanize } from './humanizer';
import { addRef, editGuide, rebuildGuide, rememberPalette, removeRef, resumeStyle, retryRef, setStyleNotifier, styleView, undoGuide, updateRef } from './style';
import { LlmError } from './llm';
import { setFileFinder, setLongKeeper } from '../src/sim/ops';
import { appsReady, appsView, catalog, connectApp, disconnectApp, forgetApps, setAccess } from './composio';
import { actOnAction, getAction } from './approvals';
import { actOnChange, approveManifest, forgetProject, getChange, linkFile, newToken, patchProject, projectView, reconnect, startProject } from './project';
import { getSettings, patchSettings } from './settings';
import { deleteSecret, listSecrets, openVault, redact, SECRET_NAME, setSecret } from './vault';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const MAX_BODY = 64 * 1024;
/** Screen preferences the browser keeps here as well: the office layout and the theme. */
const PREFS = ['layout', 'theme'];

ensureDataDir();
openDb();
openVault();
setFileFinder(fileInfo);
setLongKeeper((text) => {
  try {
    return makeFile('mensaje.md', text);
  } catch {
    return null;
  }
});

const sockets = new Set<WebSocket>();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A saved preference with when it was saved (copies from before there were dates count as oldest). */
function readPref(name: string): { value: string; at: number } | null {
  const v = getJson<{ value: string; at: number } | string>(`pref:${name}`);
  if (typeof v === 'string') return { value: v, at: 0 };
  return v ?? null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

/** A file's bytes as they come (uploads), up to `max`. */
async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

/** Production: serve the built app from dist/ (never anything outside it). */
function serveStatic(pathname: string, res: ServerResponse): void {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep)) return json(res, 404, { error: 'not found' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) return json(res, 404, { error: 'Sin build: usa `npm run dev` o `npm run build`.' });
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' });
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const authed = validToken(req.headers['x-oficina-token'] as string | undefined);

  if (!path.startsWith('/api/')) return serveStatic(path, res);

  // The token goes only to this app's own pages (fetch from the same origin).
  if (path === '/api/session' && req.method === 'GET') {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return json(res, 403, { error: 'forbidden' });
    return json(res, 200, { token: TOKEN });
  }

  if (!authed) return json(res, 401, { error: 'unauthorized' });

  // Chat files: you send one (raw bytes, its name in a header); the app's pages fetch them back.
  if (path === '/api/files' && req.method === 'POST') {
    const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).slice(0, 200);
    let bytes: Buffer;
    try {
      bytes = await readRaw(req, MAX_FILE);
    } catch {
      return json(res, 413, { error: 'Pesa demasiado: el máximo son 20 MB' });
    }
    try {
      const saved = saveFile(name, bytes);
      // Colours the browser measured in a picture (kept in case it becomes a style reference).
      const palette = req.headers['x-file-palette'];
      if (saved.kind === 'image' && typeof palette === 'string' && palette.length < 2000) {
        try {
          rememberPalette(saved.id, JSON.parse(decodeURIComponent(palette)));
        } catch {
          /* not a palette: the picture is kept anyway */
        }
      }
      return json(res, 200, saved);
    } catch (e) {
      return json(res, 400, { error: (e as Error).message });
    }
  }
  const file = /^\/api\/files\/([a-z0-9]{1,40})$/.exec(path);
  if (file && req.method === 'GET') {
    const info = fileInfo(file[1]);
    const bytes = info && fileBytes(info.id);
    if (!info || !bytes) return json(res, 404, { error: 'not found' });
    res.writeHead(200, fileHeaders(info));
    return void res.end(bytes);
  }

  // Pictures: today's free allowance, and one test picture to see that it works.
  if (path === '/api/images/usage' && req.method === 'GET') return json(res, 200, await imageUsage());
  if (path === '/api/images/test' && req.method === 'POST') {
    try {
      return json(res, 200, await draw('Product mockup: a plain white t-shirt laid flat on a light oak table, soft natural daylight, minimal, high detail, studio photo', 'cuadrada', 'prueba'));
    } catch (e) {
      return json(res, 400, { error: (e as Error).message });
    }
  }

  // LinkedIn: your voice, the weekly plan and the humanizer (Ajustes → Conectores, once it's connected).
  if (path === '/api/linkedin' && req.method === 'GET') return json(res, 200, linkedinView());
  if (path === '/api/linkedin/voice' && req.method === 'PUT') {
    const problem = setVoice(((await readBody(req)) as { text?: unknown } | null)?.text);
    return problem ? json(res, 400, { error: problem }) : json(res, 200, linkedinView());
  }
  if (path === '/api/linkedin/voice/draft' && req.method === 'POST') {
    try {
      return json(res, 200, { text: await draftVoice(((await readBody(req)) as { posts?: unknown } | null)?.posts) });
    } catch (e) {
      return json(res, 400, { error: redact((e as Error).message) });
    }
  }
  if (path === '/api/linkedin/plan' && req.method === 'PUT') {
    const problem = setPlan(await readBody(req));
    return problem ? json(res, 400, { error: problem }) : json(res, 200, linkedinView());
  }
  if (path === '/api/linkedin/plan/redo' && req.method === 'POST') return redoPlan(), json(res, 200, linkedinView());
  if (path === '/api/linkedin/humanize' && req.method === 'POST') {
    const text = ((await readBody(req)) as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) return json(res, 400, { error: 'Pega un texto de hasta 8.000 caracteres' });
    return json(res, 200, humanize(text));
  }

  // The art director's references and the style guide (Equipo → their file → Estilo).
  if (path === '/api/refs') {
    if (req.method === 'GET') return json(res, 200, styleView());
    if (req.method === 'POST') {
      const b = (await readBody(req)) as { fileId?: unknown; palette?: unknown; note?: unknown } | null;
      if (typeof b?.fileId !== 'string') return json(res, 400, { error: 'Falta la imagen' });
      const r = addRef(b.fileId, 'upload', b.palette, typeof b.note === 'string' ? b.note : '');
      return typeof r === 'string' ? json(res, 400, { error: r }) : json(res, 200, r);
    }
  }
  const ref = /^\/api\/refs\/(r[0-9a-f]{10})(\/analyze)?$/.exec(path);
  if (ref) {
    if (ref[2] && req.method === 'POST') return retryRef(ref[1]), json(res, 200, { ok: true });
    if (!ref[2] && req.method === 'PUT') {
      const problem = updateRef(ref[1], ((await readBody(req)) ?? {}) as Record<string, unknown>);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, { ok: true });
    }
    if (!ref[2] && req.method === 'DELETE') return removeRef(ref[1]), json(res, 200, { ok: true });
  }
  if (path === '/api/style' && req.method === 'PUT') {
    const problem = editGuide(await readBody(req));
    return problem ? json(res, 400, { error: problem }) : json(res, 200, styleView());
  }
  if (path === '/api/style/rebuild' && req.method === 'POST') {
    const problem = rebuildGuide();
    return problem ? json(res, 400, { error: problem }) : json(res, 200, { ok: true });
  }
  if (path === '/api/style/undo' && req.method === 'POST') {
    const problem = undoGuide();
    return problem ? json(res, 400, { error: problem }) : json(res, 200, styleView());
  }

  // A ready-made team: who's kept (ids from the preview) and whether adopted people get the post's card.
  const tpl = path.match(/^\/api\/team\/templates\/(arte|crecimiento|producto)$/);
  if (tpl && req.method === 'POST') {
    const body = (await readBody(req)) as { keep?: unknown; profiles?: unknown } | null;
    const keep = Array.isArray(body?.keep) ? body.keep.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 30) : [];
    const result = mutate(() => applyTemplate(tpl[1] as TeamId, { keep, profiles: body?.profiles !== false }));
    return typeof result === 'string' ? json(res, 400, { error: result }) : json(res, 200, result);
  }

  // A new agent from your description: the AI organises it into a card for you to edit (nothing is created).
  if (path === '/api/agents/draft' && req.method === 'POST') {
    const body = (await readBody(req)) as { text?: unknown } | null;
    if (typeof body?.text !== 'string') return json(res, 400, { error: 'Falta la descripción' });
    try {
      return json(res, 200, await draftAgent(body.text));
    } catch (e) {
      return json(res, e instanceof LlmError && e.status === 429 ? 429 : 400, { error: redact((e as Error).message) });
    }
  }

  if (path === '/api/settings') {
    if (req.method === 'GET') return json(res, 200, getSettings());
    if (req.method === 'PUT') return json(res, 200, patchSettings(await readBody(req)));
  }

  // Does the saved key for this AI provider work? (One tiny request; the key is never returned.)
  if (path === '/api/ai/test' && req.method === 'POST') {
    const body = (await readBody(req)) as { provider?: unknown } | null;
    return json(res, 200, await testKey(body?.provider));
  }

  // The weather outside, for the «Auto» sky (see weather.ts: only the city's rough position goes out).
  if (path === '/api/weather' && req.method === 'GET') return json(res, 200, await liveWeather());

  // How you've set up the office on screen (layout, finishes, theme): kept here so it survives
  // another browser, a private window or cleared site data. Plain JSON, never secrets.
  if (path === '/api/prefs' && req.method === 'GET') return json(res, 200, Object.fromEntries(PREFS.map((p) => [p, readPref(p)])));
  const pref = /^\/api\/prefs\/([a-z]{1,16})$/.exec(path);
  if (pref && req.method === 'PUT') {
    if (!PREFS.includes(pref[1])) return json(res, 404, { error: 'not found' });
    const body = (await readBody(req)) as { value?: unknown; at?: unknown } | null;
    if (typeof body?.value !== 'string' || body.value.length > 60_000 || typeof body.at !== 'number' || !Number.isFinite(body.at)) return json(res, 400, { error: 'Valor no válido' });
    try {
      JSON.parse(body.value);
    } catch {
      return json(res, 400, { error: 'Valor no válido' });
    }
    // An older copy (a browser that was closed for a while) never replaces a newer one.
    const had = readPref(pref[1]);
    if (!had || body.at >= had.at) setJson(`pref:${pref[1]}`, { value: body.value, at: body.at });
    return json(res, 200, { ok: true });
  }

  // Connector library: references to vault values only, never the values.
  if (path === '/api/mcp' && req.method === 'GET') return json(res, 200, listMcp());
  // Whether each one runs, how many tools it brings, and how far agents may go with it.
  if (path === '/api/mcp/status' && req.method === 'GET') return json(res, 200, mcpStatus());
  const mcpOp = /^\/api\/mcp\/([a-z0-9_]{1,24})\/(test|access)$/.exec(path);
  if (mcpOp) {
    if (mcpOp[2] === 'test' && req.method === 'POST') return json(res, 200, await testMcp(mcpOp[1]));
    if (mcpOp[2] === 'access' && req.method === 'PUT') {
      const problem = setMcpAccess(mcpOp[1], ((await readBody(req)) as { access?: unknown } | null)?.access);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, mcpStatus());
    }
  }
  const mcp = /^\/api\/mcp\/([a-z0-9_]{1,24})$/.exec(path);
  if (mcp) {
    if (req.method === 'PUT') {
      const problem = putMcp(await readBody(req));
      // Changed: it restarts with the new settings next time it's needed.
      if (!problem) await forgetMcp(mcp[1]);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, listMcp());
    }
    if (req.method === 'DELETE') {
      await forgetMcp(mcp[1]);
      deleteMcp(mcp[1]);
      return json(res, 200, listMcp());
    }
  }

  // Your real project, through oficina-link. The token for HTTPS never comes back: only its hash.
  if (path === '/api/project') {
    if (req.method === 'GET') return json(res, 200, projectView());
    if (req.method === 'PUT') {
      const problem = patchProject(await readBody(req));
      return problem ? json(res, 400, { error: problem }) : json(res, 200, projectView());
    }
    if (req.method === 'DELETE') {
      forgetProject();
      return json(res, 200, projectView());
    }
  }
  if (req.method === 'PUT' && path === '/api/project/approve') {
    const problem = approveManifest(((await readBody(req)) as { manifest?: unknown } | null)?.manifest);
    return problem ? json(res, 400, { error: problem }) : json(res, 200, projectView());
  }
  if (req.method === 'PUT' && path === '/api/project/token') {
    newToken();
    return json(res, 200, projectView());
  }
  if (req.method === 'PUT' && path === '/api/project/reconnect') {
    await reconnect();
    return json(res, 200, projectView());
  }
  if (req.method === 'GET' && path === '/api/project/link') return json(res, 200, linkFile());
  const change = /^\/api\/project\/changes\/([a-z0-9]{1,24})$/.exec(path);
  if (change) {
    if (req.method === 'GET') {
      const c = getChange(change[1]);
      return c ? json(res, 200, c) : json(res, 404, { error: 'not found' });
    }
    if (req.method === 'PUT') {
      const problem = await actOnChange(change[1], ((await readBody(req)) as { action?: unknown } | null)?.action);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, getChange(change[1]));
    }
  }

  // Your apps through Composio: catalog, connect (a sign-in page to open), disconnect, how far
  // each may be used, and your yes or no to what an agent wants to do in one. Never a key or token.
  if (path === '/api/apps' && req.method === 'GET') return json(res, 200, await appsView());
  if (path === '/api/apps/catalog' && req.method === 'GET') {
    const out = await catalog(url.searchParams.get('fresh') === '1');
    return Array.isArray(out) ? json(res, 200, out) : json(res, 400, out);
  }
  const appAct = /^\/api\/apps\/actions\/(a[0-9a-f]{10})$/.exec(path);
  if (appAct) {
    if (req.method === 'GET') {
      const a = getAction(appAct[1]);
      return a ? json(res, 200, a) : json(res, 404, { error: 'not found' });
    }
    if (req.method === 'PUT') {
      const body = (await readBody(req)) as { action?: unknown; text?: unknown } | null;
      const problem = await actOnAction(appAct[1], body?.action, body?.text);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, getAction(appAct[1]));
    }
  }
  const app = /^\/api\/apps\/([a-z0-9][a-z0-9_-]{0,63})(\/connect|\/access)?$/.exec(path);
  if (app) {
    if (app[2] === '/connect' && req.method === 'POST') {
      const out = await connectApp(app[1]);
      return 'url' in out ? json(res, 200, out) : json(res, 400, out);
    }
    if (app[2] === '/access' && req.method === 'PUT') {
      const problem = setAccess(app[1], ((await readBody(req)) as { access?: unknown } | null)?.access);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, await appsView());
    }
    if (!app[2] && req.method === 'DELETE') {
      const problem = await disconnectApp(app[1]);
      return problem ? json(res, 400, { error: problem }) : json(res, 200, await appsView());
    }
  }

  // Secrets are write-only from the browser: names and last 4 characters come back, never values.
  if (path === '/api/secrets' && req.method === 'GET') return json(res, 200, listSecrets());
  const secret = /^\/api\/secrets\/([^/]+)$/.exec(path);
  if (secret) {
    const name = secret[1];
    if (!SECRET_NAME.test(name)) return json(res, 400, { error: 'Nombre no válido' });
    // A connector's value changed: it restarts with it next time.
    for (const srv of listMcp()) if (name.startsWith(`mcp_${srv.id}_`)) void forgetMcp(srv.id);
    if (req.method === 'PUT') {
      const body = (await readBody(req)) as { value?: unknown } | null;
      if (typeof body?.value !== 'string' || !body.value.trim() || body.value.length > 8192) return json(res, 400, { error: 'Valor no válido' });
      setSecret(name, body.value.trim());
      if (name === 'composio_api_key') {
        forgetApps();
        void appsReady();
      }
      return json(res, 200, listSecrets());
    }
    if (req.method === 'DELETE') {
      deleteSecret(name);
      if (name === 'composio_api_key') forgetApps();
      return json(res, 200, listSecrets());
    }
  }

  return json(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  handle(req, res).catch((e: Error) => {
    console.error(redact(String(e?.stack ?? e)));
    if (!res.headersSent) json(res, 400, { error: 'bad request' });
  });
});

// Room for a long chat message (it's kept as a document once it arrives).
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws' || !trustedRequest(req) || !validToken(url.searchParams.get('token'))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);
    ws.send(JSON.stringify({ type: 'state', kind: 'change', state: snapshot() }));
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: unknown; name?: unknown; args?: unknown };
        if (msg.type !== 'cmd') return;
        const refusal = runCommand(msg.name, msg.args);
        if (refusal) ws.send(JSON.stringify({ type: 'refused', text: refusal }));
      } catch {
        /* malformed message: ignore */
      }
    });
    ws.on('close', () => sockets.delete(ws));
  });
});

const stop = startOffice((kind, state) => {
  const msg = JSON.stringify({ type: 'state', kind, state });
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(msg);
});

// The Estilo tab refreshes when a reference or the guide changes.
setStyleNotifier(() => {
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send('{"type":"refs"}');
});
resumeStyle();
setLinkedInNotifier(() => {
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send('{"type":"linkedin"}');
});
const stopLinkedIn = startLinkedIn();

// The Proyecto tab refreshes when the connection or its log changes (the view itself goes over /api).
const stopProject = startProject(() => {
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send('{"type":"project"}');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Oficina: servidor local en http://127.0.0.1:${PORT} (datos en ${DATA_DIR})`);
  // Your apps known from the start: the agents' first answer already has them.
  void appsReady();
});

function shutdown(): void {
  stopLinkedIn();
  stopProject();
  stop();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
