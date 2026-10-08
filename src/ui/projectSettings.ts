/**
 * Ajustes → Proyecto: connect your real project, see exactly what the team may read and write,
 * and copy everything the project needs (the manifest, the link file, the prompt for your AI).
 */
import {
  BLOCKED_LIST,
  installPrompt,
  manifestTemplate,
  MANIFEST_FILE,
  PROTECTED_LIST,
  READ_PERMS,
  SOURCES_EXAMPLE,
  SOURCES_FILE,
  TOKEN_ENV,
  WRITE_LEVELS,
  WRITE_ROLES,
  WRITE_RULES,
  type LinkMode,
  type ProjectView,
  type ReadPerm,
  type WriteLevel,
} from '../sim/project';
import { ROLES } from '../sim/seed';
import { api } from '../sim/store';
import { CHANGE_STATUS, openChange } from './changeDialog';
import { esc, stamp } from './dom';
import { icon } from './icons';

let view: ProjectView | null = null;
/** The connection type picked on screen, before saving it. */
let pickMode: LinkMode | null = null;
/** "Escribir sin preguntar" picked: waiting for you to type the project's name. */
let confirming = false;
let forgetArmed = false;
let problem: { where: string; text: string } | null = null;
let copied = '';
/** Texts behind each «Copiar» button, filled while rendering. */
const copies = new Map<string, string>();

export async function loadProject(): Promise<ProjectView | null> {
  try {
    view = await api<ProjectView>('/api/project');
  } catch {
    view = null;
  }
  return view;
}

const MODES: { id: LinkMode; label: string; about: string }[] = [
  { id: 'local', label: 'En este ordenador', about: 'La oficina ejecuta su propio enlace contra la carpeta. En el proyecto solo va el manifiesto.' },
  { id: 'ssh', label: 'En un servidor, por SSH', about: 'Lo más seguro para remoto: sin puertos abiertos, con tus claves SSH. El servidor tiene que estar ya en known_hosts.' },
  { id: 'https', label: 'En un servidor, por HTTPS', about: 'Para hostings sin SSH. El enlace escucha detrás de tu proxy https y solo acepta el token de esta oficina.' },
];

const STATE_LABEL = { off: 'Sin conectar', connecting: 'Conectando…', review: 'Revisa los permisos', ready: 'Conectado', error: 'Sin conexión' } as const;

function copyBlock(key: string, label: string, text: string, open = true): string {
  copies.set(key, text);
  const body = `<pre class="copy-text" tabindex="0">${esc(text)}</pre>`;
  return `
    <div class="copy">
      <div class="copy-head">
        <span class="copy-label">${label}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-copy="${key}">${copied === key ? `${icon.tick(14)}Copiado` : `${icon.copy(14)}Copiar`}</button>
      </div>
      ${open ? body : `<details><summary>Ver</summary>${body}</details>`}
    </div>`;
}

const err = (where: string) => (problem?.where === where ? `<p class="field-error" role="alert">${esc(problem.text)}</p>` : '');
const short = (h: string) => `<span class="num">${esc(h.slice(0, 12))}</span>`;

function manifestSummary(v: ProjectView): string {
  const i = v.info!;
  const w = i.write;
  return `
    <dl class="proj-dl">
      <dt>Proyecto</dt><dd>${esc(i.name)}</dd>
      <dt>Puede leer</dt><dd>${i.read.paths.map((p) => `<code>${esc(p)}</code>`).join(' ')}</dd>
      <dt>Además</dt><dd>${[i.read.git && i.git ? 'historial de git' : '', i.read.watch ? 'cambios en vivo' : '', i.read.sources ? `datos de la app (${i.fuentes.map((f) => esc(f.nombre)).join(', ') || esc(i.read.sources)})` : ''].filter(Boolean).join(' · ') || 'nada más'}</dd>
      <dt>Escritura</dt><dd>${
        w.mode === 'off'
          ? 'no permitida'
          : `<strong class="danger">${esc(WRITE_LEVELS.find((l) => l.id === w.mode)!.label.toLowerCase())}</strong> en ${w.paths.map((p) => `<code>${esc(p)}</code>`).join(' ')} · hasta ${w.maxKb} KB${w.delete ? ' · <strong class="danger">puede borrar</strong>' : ''}`
      }</dd>
      <dt>Manifiesto</dt><dd>${short(i.manifest)} · oficina-link ${esc(i.version)}${i.version !== v.linkVersion ? ` <span class="danger">(la oficina trae la ${esc(v.linkVersion)}: actualiza el del servidor)</span>` : ''}</dd>
    </dl>`;
}

function status(v: ProjectView): string {
  const c = v.config;
  const modeLabel = MODES.find((m) => m.id === c.mode)!.label.toLowerCase();
  let body = '';
  let buttons = '';
  if (v.state === 'off') {
    body = '<p class="section-note">Los agentes trabajan sin ver tu proyecto. Configúralo abajo y conéctalo.</p>';
  } else if (v.state === 'connecting') {
    body = `<p class="section-note">Conectando ${esc(modeLabel)}…</p>`;
    buttons = '<button class="btn btn-sm" type="button" data-proj-off>Cancelar</button>';
  } else if (v.state === 'error') {
    body = `<p class="field-error">${esc(v.error)}</p><p class="section-note">Se reintenta solo cada poco.</p>`;
    buttons = `<button class="btn btn-sm" type="button" data-proj-retry>${icon.refresh(14)}Reintentar</button><button class="btn btn-ghost btn-sm" type="button" data-proj-off>Desconectar</button>`;
  } else if (v.state === 'review') {
    body = `
      ${v.changedSinceApproval ? '<p class="settings-note"><strong>El manifiesto ha cambiado desde que lo aprobaste.</strong> Hasta que lo revises, nadie puede leer ni escribir nada. Si no esperabas este cambio, no lo apruebes.</p>' : '<p class="section-note">Esto es lo que tu proyecto permite. Nada se usa hasta que lo apruebes; luego puedes recortarlo aquí abajo.</p>'}
      ${manifestSummary(v)}`;
    buttons = `<button class="btn btn-primary btn-sm" type="button" data-proj-approve="${esc(v.info!.manifest)}">${icon.tick(14)}Aprobar estos permisos</button><button class="btn btn-ghost btn-sm" type="button" data-proj-off>Desconectar</button>`;
  } else {
    body = `<p class="section-note">${esc(modeLabel)} · oficina-link ${esc(v.info!.version)} · manifiesto ${short(v.info!.manifest)}</p>`;
    buttons = `<button class="btn btn-ghost btn-sm" type="button" data-proj-retry>${icon.refresh(14)}Reconectar</button><button class="btn btn-ghost btn-sm" type="button" data-proj-off>Desconectar</button>`;
  }
  return `
    <section class="proj-status is-${v.state}" aria-live="polite">
      <div class="proj-status-head">
        <span class="proj-dot" aria-hidden="true"></span>
        <strong>${STATE_LABEL[v.state]}${v.state === 'ready' ? ` a «${esc(v.info!.name)}»` : ''}</strong>
      </div>
      ${body}
      ${buttons ? `<div class="proj-actions">${buttons}</div>` : ''}
      ${err('status')}
    </section>`;
}

function where(v: ProjectView, mode: LinkMode): string {
  const c = v.config;
  const fields =
    mode === 'local'
      ? `<div class="field">
           <label for="p-path">Carpeta del proyecto</label>
           <input id="p-path" name="path" value="${esc(c.path)}" placeholder="/Users/tu/proyectos/mi-web" autocomplete="off" spellcheck="false" />
         </div>`
      : mode === 'ssh'
        ? `<div class="field-row">
             <div class="field"><label for="p-host">Servidor</label><input id="p-host" name="host" value="${esc(c.ssh.host)}" placeholder="usuario@servidor.com" autocomplete="off" spellcheck="false" /></div>
             <div class="field"><label for="p-port">Puerto</label><input id="p-port" name="port" type="number" min="1" max="65535" value="${c.ssh.port}" inputmode="numeric" /></div>
           </div>
           <div class="field"><label for="p-root">Carpeta del proyecto en el servidor</label><input id="p-root" name="root" value="${esc(c.ssh.root)}" placeholder="/srv/mi-web" autocomplete="off" spellcheck="false" /></div>
           <div class="field-row">
             <div class="field"><label for="p-link">Enlace en el servidor</label><input id="p-link" name="link" value="${esc(c.ssh.link)}" autocomplete="off" spellcheck="false" /></div>
             <div class="field"><label for="p-node">Node en el servidor</label><input id="p-node" name="node" value="${esc(c.ssh.node)}" placeholder="node" autocomplete="off" spellcheck="false" /></div>
           </div>
           <p class="section-note">Entra una vez a mano con <code>ssh ${esc(c.ssh.host || 'usuario@servidor')}</code> para guardar su huella: si un día cambia, la oficina no se conecta.</p>`
        : `<div class="field"><label for="p-url">Dirección del enlace</label><input id="p-url" name="url" value="${esc(c.url)}" placeholder="https://tudominio.com/oficina/mcp" autocomplete="off" spellcheck="false" /></div>
           ${
             v.tokenHash
               ? `${copyBlock('env', `Variable para el servidor (es el hash; el token no sale de aquí)`, `${TOKEN_ENV}=${v.tokenHash}`)}
                  <button class="btn btn-ghost btn-sm" type="button" data-proj-token>Generar otro token (el anterior deja de valer)</button>`
               : `<button class="btn btn-sm" type="button" data-proj-token>Generar token</button>`
           }`;
  return `
    <section class="settings-section">
      <h3 class="section-title">1. Dónde está tu proyecto</h3>
      <div class="proj-modes" role="radiogroup" aria-label="Dónde está">
        ${MODES.map(
          (m) => `
          <label class="proj-mode${m.id === mode ? ' is-on' : ''}">
            <input type="radio" name="proj-mode" value="${m.id}" data-proj-mode ${m.id === mode ? 'checked' : ''} />
            <span><strong>${m.label}</strong><span class="meta">${m.about}</span></span>
          </label>`,
        ).join('')}
      </div>
      <form class="settings-section" data-proj-where novalidate>
        ${fields}
        ${err('where')}
        <button class="btn btn-primary" type="submit">${v.config.enabled && v.config.mode === mode ? 'Guardar y reconectar' : 'Guardar y conectar'}</button>
      </form>
    </section>`;
}

function prepare(v: ProjectView, mode: LinkMode): string {
  const remote = mode !== 'local';
  const prompt = installPrompt(mode, v.linkSha, v.tokenHash);
  const caddy = `tudominio.com {\n  handle_path /oficina/* {\n    reverse_proxy 127.0.0.1:8790\n  }\n}`;
  return `
    <section class="settings-section">
      <h3 class="section-title">2. Prepara tu proyecto</h3>
      <ol class="proj-steps">
        ${
          remote
            ? `<li>
                 <p>Descarga el enlace (un solo archivo, sin dependencias, Node 20+). Su huella SHA-256 tiene que coincidir:</p>
                 <p><button class="btn btn-sm" type="button" data-proj-download>${icon.download(14)}Descargar oficina-link.mjs</button></p>
                 ${copyBlock('sha', 'Huella', v.linkSha)}
               </li>`
            : ''
        }
        <li>
          <p>Pega este prompt en la IA que trabaja en tu proyecto (Claude Code, Cursor…)${remote ? ' junto con el archivo' : ''}. Creará <code>${MANIFEST_FILE}</code> en solo lectura${remote ? ' y lo dejará instalado' : ''}.</p>
          ${copyBlock('prompt', 'Prompt para tu IA', prompt, false)}
        </li>
        <li>
          <p>O hazlo tú: crea <code>${MANIFEST_FILE}</code> en la raíz del proyecto y ajusta las rutas.</p>
          ${copyBlock('manifest', MANIFEST_FILE, manifestTemplate(), false)}
          <p class="section-note">Opcional: <code>${SOURCES_FILE}</code> con funciones de solo lectura para que vean datos de tu app (agregados, nunca datos personales) y <code>"sources": "${SOURCES_FILE}"</code> en el manifiesto.</p>
          ${copyBlock('sources', SOURCES_FILE, SOURCES_EXAMPLE, false)}
        </li>
        ${
          mode === 'https'
            ? `<li>
                 <p>En el servidor, como servicio, escuchando solo en 127.0.0.1 y publicado por tu proxy https:</p>
                 ${copyBlock('start', 'Arrancar', `${TOKEN_ENV}=${v.tokenHash ?? '<genera el token arriba>'} node oficina-link.mjs --root /ruta/al/proyecto --http --port 8790`)}
                 ${copyBlock('caddy', 'Ejemplo con Caddy (https automático)', caddy, false)}
               </li>`
            : ''
        }
        ${remote ? `<li><p>Comprueba en el servidor: <code>node oficina-link.mjs --root /ruta/al/proyecto --check</code></p></li>` : ''}
        <li><p>Conecta arriba y aprueba los permisos que pide el proyecto.</p></li>
      </ol>
    </section>`;
}

function reading(v: ProjectView): string {
  const ready = v.state === 'ready';
  return `
    <section class="settings-section">
      <h3 class="section-title">3. Qué pueden leer</h3>
      <p class="section-note">Lectura no daña nada, pero cuanto menos vean, menos se distraen y menos gastan. Puedes recortar lo que el proyecto permite; ampliarlo solo se hace en su manifiesto.</p>
      <ul class="proj-perms">
        ${READ_PERMS.map((p) => {
          const pv = v.perms.find((x) => x.id === p.id)!;
          const locked = !ready || !pv.allowed;
          const checked = ready ? pv.on : !v.config.off.includes(p.id) && (!v.info || pv.allowed);
          return `
            <li>
              <label class="check${locked ? ' is-locked' : ''}">
                <input type="checkbox" data-proj-perm="${p.id}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} />
                <span><strong>${p.label}</strong><span class="meta">${p.about}${v.info && !pv.allowed ? ' · <em>tu proyecto no lo permite</em>' : ''}</span></span>
              </label>
            </li>`;
        }).join('')}
      </ul>
      ${ready ? '' : '<p class="section-note">Se activan al conectar.</p>'}
      ${err('perms')}
    </section>`;
}

function writing(v: ProjectView): string {
  const ready = v.state === 'ready';
  const chosen = v.config.write;
  const manifestMode = v.info?.write.mode ?? 'off';
  const writers = WRITE_ROLES.map((r) => ROLES[r].label).join(', ');
  const example = JSON.stringify({ mode: 'propuesta', paths: ['src/**', 'docs/**'], delete: false, maxKb: 100 }, null, 2);
  return `
    <section class="settings-section">
      <h3 class="section-title">4. Escritura</h3>
      <div class="proj-warning" role="note">
        ${icon.alert(18)}
        <p><strong>Activar la escritura permite que los agentes modifiquen tu proyecto raíz.</strong> Un error, o una instrucción maliciosa escondida en el código o en una web que lean, puede romper el proyecto, borrar trabajo o meter código que acabe ejecutándose en tu equipo o en producción. <strong>No se recomienda.</strong> Si la activas, usa «Proponer cambios»: nada se escribe sin que lo apruebes tú.</p>
      </div>
      <div class="proj-modes" role="radiogroup" aria-label="Escritura">
        ${WRITE_LEVELS.map(
          (l) => `
          <label class="proj-mode${l.id === chosen ? ' is-on' : ''}${l.id === 'directo' ? ' is-risky' : ''}">
            <input type="radio" name="proj-write" value="${l.id}" data-proj-write ${l.id === (confirming ? 'directo' : chosen) ? 'checked' : ''} ${ready ? '' : 'disabled'} />
            <span><strong>${l.label}</strong><span class="meta">${l.about}</span></span>
          </label>`,
        ).join('')}
      </div>
      ${
        confirming && v.info
          ? `<form class="proj-confirm" data-proj-confirm novalidate>
               <label for="p-confirm">Para escribir sin preguntar, escribe <strong>${esc(v.info.name)}</strong></label>
               <span class="key-row">
                 <input id="p-confirm" name="confirm" autocomplete="off" spellcheck="false" />
                 <button class="btn btn-danger btn-sm" type="submit">Activar</button>
                 <button class="btn btn-ghost btn-sm" type="button" data-proj-confirm-cancel>Cancelar</button>
               </span>
             </form>`
          : ''
      }
      ${err('write')}
      ${
        ready && chosen !== 'off' && v.write !== chosen
          ? `<p class="settings-note">Tu proyecto solo permite «${esc(WRITE_LEVELS.find((l) => l.id === manifestMode)!.label)}» (<code>write.mode</code> en su manifiesto): es lo que vale ahora.</p>`
          : ''
      }
      ${!ready ? '<p class="section-note">Conecta el proyecto para elegir.</p>' : ''}
      <div class="proj-rules">
        <h4>Siempre, aunque la actives</h4>
        <ul>${WRITE_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <h4>Nunca se pueden escribir</h4>
        <ul>${PROTECTED_LIST.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <h4>Quién puede cambiar archivos</h4>
        <p>${esc(writers)}. El resto del equipo solo lee.</p>
        <h4>Doble llave</h4>
        <p>Además de aquí, el manifiesto del proyecto tiene que permitirlo; vale lo más restrictivo de los dos. Por ejemplo:</p>
        ${copyBlock('write', '"write" en el manifiesto', `"write": ${example}`, false)}
      </div>
    </section>`;
}

function activity(v: ProjectView): string {
  const time = (t: number) => `<span class="num">${stamp(t)}</span>`;
  return `
    <section class="settings-section">
      <h3 class="section-title">Siempre bloqueado</h3>
      <p class="section-note">Ni leer ni escribir, diga lo que diga el manifiesto:</p>
      <ul class="proj-blocked">${BLOCKED_LIST.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    </section>
    <section class="settings-section">
      <h3 class="section-title">Actividad</h3>
      ${
        v.changes.length
          ? `<h4 class="proj-sub">Cambios en archivos</h4>
             <ul class="proj-log">${v.changes
               .slice(0, 12)
               .map(
                 (c) => `
               <li>
                 <span class="proj-log-main"><code>${esc(c.path)}</code> <span class="meta">${esc(c.byName)} · ${time(c.at)} · <span class="change-status is-${c.status}">${CHANGE_STATUS[c.status]}</span> · <span class="diff-add-t">+${c.added}</span> <span class="diff-del-t">−${c.removed}</span></span></span>
                 <button class="btn btn-ghost btn-sm" type="button" data-change-open="${c.id}">Ver</button>
               </li>`,
               )
               .join('')}</ul>`
          : ''
      }
      <h4 class="proj-sub">Últimos accesos</h4>
      ${
        v.access.length
          ? `<ul class="proj-log">${v.access
              .slice(0, 15)
              .map(
                (a) => `<li><span class="proj-log-main"><span class="${a.ok ? '' : 'danger'}">${a.ok ? '✓' : '✕'}</span> ${esc(a.who)} · ${esc(a.tool)}${a.target ? ` <code>${esc(a.target)}</code>` : ''} <span class="meta">${time(a.at)}${a.note ? ` · ${esc(a.note)}` : ''}</span></span></li>`,
              )
              .join('')}</ul>`
          : '<p class="section-note">Aún nadie ha mirado el proyecto.</p>'
      }
      ${
        v.live.length
          ? `<h4 class="proj-sub">Guardado en el proyecto</h4>
             <ul class="proj-log">${v.live.slice(0, 8).map((l) => `<li><span class="proj-log-main">${time(l.at)} ${l.paths.slice(0, 6).map((p) => `<code>${esc(p)}</code>`).join(' ')}${l.paths.length > 6 ? ` +${l.paths.length - 6}` : ''}</span></li>`).join('')}</ul>`
          : ''
      }
      ${v.linkLog.length ? `<details class="proj-linklog"><summary>Registro del enlace</summary><pre>${esc(v.linkLog.join('\n'))}</pre></details>` : ''}
    </section>
    <button class="btn btn-ghost btn-danger-text" type="button" data-proj-forget>${forgetArmed ? 'Pulsa otra vez para olvidar el proyecto' : 'Olvidar este proyecto'}</button>`;
}

/** The whole tab. */
export function projectPanel(): string {
  copies.clear();
  if (!view) return '<div class="settings-form"><p class="field-error">No se pudo cargar. ¿Está en marcha el servidor local?</p></div>';
  const v = view;
  const mode = pickMode ?? v.config.mode;
  return `
    <div class="settings-form proj">
      <p class="settings-lead">Conecta tu proyecto real (código, documentación y datos de tu app) para que el equipo trabaje con lo que hay de verdad, en vivo. Por defecto <strong>solo leen</strong>, y nunca ven tus secretos.</p>
      ${status(v)}
      ${where(v, mode)}
      ${prepare(v, mode)}
      ${reading(v)}
      ${writing(v)}
      ${activity(v)}
    </div>`;
}

async function put(where: string, path: string, body: unknown, render: () => void): Promise<boolean> {
  problem = null;
  try {
    view = await api<ProjectView>(path, 'PUT', body);
    render();
    return true;
  } catch (e) {
    problem = { where, text: (e as Error).message };
    render();
    return false;
  }
}

/** Clicks inside the tab; true if it was one of ours. */
export async function projectClick(t: HTMLElement, render: () => void): Promise<boolean> {
  if (!t.closest('[data-proj-forget]')) forgetArmed = false;
  const copy = t.closest<HTMLElement>('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(copies.get(copy.dataset.copy!) ?? '');
      copied = copy.dataset.copy!;
      render();
      setTimeout(() => {
        copied = '';
        render();
      }, 1600);
    } catch {
      /* the text is on screen to select by hand */
    }
    return true;
  }
  const open = t.closest<HTMLElement>('[data-change-open]');
  if (open) {
    void openChange(open.dataset.changeOpen!);
    return true;
  }
  if (t.closest('[data-proj-download]')) {
    const f = await api<{ name: string; text: string }>('/api/project/link');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([f.text], { type: 'text/javascript' }));
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  }
  if (t.closest('[data-proj-token]')) return put('where', '/api/project/token', {}, render);
  if (t.closest('[data-proj-retry]')) return put('status', '/api/project/reconnect', {}, render);
  if (t.closest('[data-proj-off]')) return put('status', '/api/project', { enabled: false }, render);
  const approve = t.closest<HTMLElement>('[data-proj-approve]');
  if (approve) return put('status', '/api/project/approve', { manifest: approve.dataset.projApprove }, render);
  if (t.closest('[data-proj-confirm-cancel]')) {
    confirming = false;
    render();
    return true;
  }
  if (t.closest('[data-proj-forget]')) {
    if (!forgetArmed) {
      forgetArmed = true;
      render();
      return true;
    }
    forgetArmed = false;
    pickMode = null;
    try {
      view = await api<ProjectView>('/api/project', 'DELETE');
    } catch {
      /* stays as it was */
    }
    render();
    return true;
  }
  return false;
}

export async function projectChange(t: HTMLInputElement, render: () => void): Promise<boolean> {
  if (t.matches('[data-proj-mode]')) {
    pickMode = t.value as LinkMode;
    problem = null;
    render();
    return true;
  }
  if (t.matches('[data-proj-perm]') && view) {
    const id = t.dataset.projPerm as ReadPerm;
    const off = t.checked ? view.config.off.filter((x) => x !== id) : [...view.config.off, id];
    await put('perms', '/api/project', { off }, render);
    return true;
  }
  if (t.matches('[data-proj-write]')) {
    const level = t.value as WriteLevel;
    // The risky one asks for the project's name first.
    if (level === 'directo') {
      confirming = true;
      render();
      document.getElementById('p-confirm')?.focus();
      return true;
    }
    confirming = false;
    await put('write', '/api/project', { write: level }, render);
    return true;
  }
  return false;
}

export async function projectSubmit(form: HTMLFormElement, render: () => void): Promise<boolean> {
  const v = (n: string) => form.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value.trim() ?? '';
  if (form.matches('[data-proj-confirm]')) {
    if (await put('write', '/api/project', { write: 'directo', confirm: v('confirm') }, render)) confirming = false;
    render();
    return true;
  }
  if (!form.matches('[data-proj-where]') || !view) return false;
  const mode = pickMode ?? view.config.mode;
  const patch =
    mode === 'local'
      ? { mode, path: v('path'), enabled: true }
      : mode === 'ssh'
        ? { mode, ssh: { host: v('host'), port: Number(v('port')), root: v('root'), link: v('link'), node: v('node') }, enabled: true }
        : { mode, url: v('url'), enabled: true };
  if (await put('where', '/api/project', patch, render)) pickMode = null;
  render();
  return true;
}

/** Live: the server says something changed (connected, a file saved, someone read). */
let target: { isOpen: () => boolean; render: () => void } | null = null;
export function watchProject(isOpen: () => boolean, render: () => void): void {
  const first = !target;
  target = { isOpen, render };
  if (!first) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('project-changed', () => {
    if (!target?.isOpen() || timer) return;
    // Bursts (a save touches several files) become one refresh.
    timer = setTimeout(async () => {
      timer = null;
      await loadProject();
      const a = document.activeElement;
      // Never re-render under your cursor while you type.
      if (a && a.closest('.proj') && a.matches('input, select, textarea')) return;
      target?.render();
    }, 400);
  });
}
