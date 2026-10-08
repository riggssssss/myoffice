import { APP_ACCESS, APP_SLUG, type AppConnection, type AppInfo, type AppsView } from '../sim/apps';
import { api } from '../sim/store';
import { esc } from './dom';
import { icon } from './icons';
import { hasSecret, keyField, secretTail } from './keyField';

/**
 * Ajustes → Conectores: the apps you've connected through Composio (and how far the agents may go
 * in each), and the whole catalog to connect more. Your Composio key lives in Ajustes → IA; the tab
 * only shows once it's there. Connecting opens the app's own sign-in page in your browser; this
 * panel watches until it's done.
 */
export const COMPOSIO_KEY = 'composio_api_key';
const KEY = COMPOSIO_KEY;
const PAGE = 48;

let view: AppsView | null = null;
let list: AppInfo[] | null = null;
let listError = '';
let query = '';
let category = '';
let shown = PAGE;
/** Apps whose sign-in page you've just opened: watched until they're connected. */
const waiting = new Map<string, number>();
let watch = 0;
let note = '';
/** First click on «Desconectar» asks; the second does it. */
let confirmOff = '';
/** The key last checked (its last four characters): a new one is checked again. */
let checked = '';

export async function loadApps(): Promise<void> {
  try {
    view = await api<AppsView>('/api/apps');
  } catch (e) {
    view = { key: hasSecret(KEY), connections: [], error: e instanceof Error ? e.message : 'No responde' };
  }
  if (view.key && !list) await loadCatalog(false);
}

async function loadCatalog(fresh: boolean): Promise<void> {
  try {
    list = await api<AppInfo[]>(`/api/apps/catalog${fresh ? '?fresh=1' : ''}`);
    listError = '';
  } catch (e) {
    listError = e instanceof Error ? e.message : 'No se pudo cargar';
  }
}

const conn = (slug: string): AppConnection | undefined => view?.connections.find((c) => c.slug === slug);
const info = (slug: string): AppInfo | undefined => list?.find((a) => a.slug === slug);

const logo = (a: AppInfo | undefined, slug: string) =>
  a?.logo
    ? `<img class="app-logo" src="${esc(a.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="app-logo app-logo-letter" aria-hidden="true">${esc((a?.name ?? slug).charAt(0).toUpperCase())}</span>`;

const STATUS: Record<AppConnection['status'], string> = {
  active: 'Conectada',
  pending: 'Esperando a que des permiso',
  failed: 'Falló al conectar',
  expired: 'Caducada: vuelve a conectarla',
  off: 'Desactivada',
};

function connected(): string {
  const mine = view?.connections ?? [];
  if (!mine.length) return '';
  return `
    <section class="settings-section">
      <h3 class="section-title">Conectadas <span class="count">${mine.length}</span></h3>
      <ul class="mcp-list">
        ${mine
          .map((c) => {
            const a = info(c.slug);
            const ok = c.status === 'active';
            return `
            <li class="mcp-row app-row">
              ${logo(a, c.slug)}
              <span class="mcp-main">
                <span class="mcp-name">${esc(a?.name ?? c.slug)}</span>
                <span class="meta${ok ? '' : ' danger'}">${STATUS[c.status]}</span>
              </span>
              ${
                ok
                  ? `<select class="app-access" data-app-access="${esc(c.slug)}" aria-label="Qué pueden hacer en ${esc(a?.name ?? c.slug)}">
                      ${APP_ACCESS.map((x) => `<option value="${x.id}" ${x.id === c.access ? 'selected' : ''} title="${esc(x.note)}">${esc(x.label)}</option>`).join('')}
                    </select>`
                  : `<button class="btn btn-ghost btn-sm" type="button" data-app-connect="${esc(c.slug)}">Volver a conectar</button>`
              }
              <button class="btn btn-ghost btn-sm btn-danger-text" type="button" data-app-off="${esc(c.slug)}">${confirmOff === c.slug ? '¿Seguro?' : 'Desconectar'}</button>
            </li>`;
          })
          .join('')}
      </ul>
      <p class="section-note">${esc(APP_ACCESS.map((x) => `${x.label}: ${x.note.toLowerCase()}`).join('. '))}.</p>
    </section>`;
}

/** Composio Connect can't list its apps: any other one is connected by its id. */
function anyApp(found: AppInfo[]): string {
  const slug = query.trim().toLowerCase().replace(/[\s.]+/g, '');
  if (view?.via !== 'connect' || !APP_SLUG.test(slug) || found.some((a) => a.slug === slug) || conn(slug)) return '';
  return `<p class="section-note"><button class="btn btn-sm" type="button" data-app-connect="${esc(slug)}">${icon.plug(14)}Conectar «${esc(slug)}»</button> Si Composio no la conoce, te lo dirá.</p>`;
}

function catalogView(): string {
  if (listError) return `<p class="section-note danger">${esc(listError)}</p>`;
  if (!list) return `<p class="section-note">Cargando el catálogo…</p>`;
  const cats = [...new Set(list.flatMap((a) => a.categories))].sort((x, y) => x.localeCompare(y, 'es'));
  const q = query.trim().toLowerCase();
  const found = list.filter(
    (a) => (!category || a.categories.includes(category)) && (!q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || a.about.toLowerCase().includes(q)),
  );
  return `
    <section class="settings-section">
      <h3 class="section-title">Todas las apps <span class="count">${list.length}</span></h3>
      <div class="apps-filter">
        <label class="apps-search">
          ${icon.search(15)}
          <input type="search" data-app-query value="${esc(query)}" placeholder="Buscar: Gmail, Instagram, Notion…" aria-label="Buscar una app" autocomplete="off" />
        </label>
        <select data-app-cat aria-label="Categoría">
          <option value="">Todas las categorías</option>
          ${cats.map((c) => `<option ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      ${
        found.length
          ? `<ul class="apps-grid">
          ${found
            .slice(0, shown)
            .map((a) => {
              const c = conn(a.slug);
              const state = c?.status === 'active' ? 'Conectada' : waiting.has(a.slug) || c?.status === 'pending' ? 'Esperando…' : '';
              return `
              <li class="app-card">
                <div class="app-card-head">
                  ${logo(a, a.slug)}
                  <span class="mcp-main">
                    <span class="mcp-name">${esc(a.name)}</span>
                    <span class="meta">${a.tools ? `${a.tools} acciones` : ''}${a.categories[0] ? ` · ${esc(a.categories[0])}` : ''}</span>
                  </span>
                </div>
                <p class="mcp-about">${esc(a.about || 'Sin descripción.')}</p>
                ${
                  state
                    ? `<span class="app-state${c?.status === 'active' ? ' is-on' : ''}">${c?.status === 'active' ? icon.tick(14) : ''}${state}</span>`
                    : `<button class="btn btn-sm ${a.ready ? 'btn-primary' : 'btn-ghost'}" type="button" data-app-connect="${esc(a.slug)}" title="${a.ready ? 'Se abre su página para que des permiso' : 'Esta app pide credenciales propias en tu panel de Composio; puedes intentarlo'}">${icon.plug(14)}${a.ready ? 'Conectar' : 'Conectar (avanzado)'}</button>`
                }
              </li>`;
            })
            .join('')}
        </ul>
        ${found.length > shown ? `<button class="btn btn-ghost" type="button" data-app-more>Ver más (${found.length - shown})</button>` : ''}`
          : `<p class="section-note">Ninguna app con «${esc(query)}» en la lista.</p>`
      }
      ${anyApp(found)}
      ${
        view?.via === 'connect'
          ? '<p class="section-note">Las más usadas de Composio, que tiene más de 500. ¿Buscas otra? Escribe su nombre y conéctala igual.</p>'
          : '<p class="section-note">Catálogo de Composio, de más a menos usadas. <button class="link" type="button" data-app-refresh>Actualizarlo</button></p>'
      }
    </section>`;
}

/** Ajustes → IA: your Composio key. With it, the Conectores tab appears. */
export function composioKeySection(): string {
  // Check the key once it's there, so a wrong one says so here, next to the field.
  if (hasSecret(KEY) && secretTail(KEY) !== checked) {
    checked = secretTail(KEY);
    view = { key: true, connections: [], error: null };
    list = null;
    void loadApps().then(() => document.dispatchEvent(new Event('apps-change')));
  }
  return `
    <section class="settings-section">
      <h3 class="section-title">Conectores</h3>
      <p class="section-note">Con una cuenta gratis de Composio el equipo puede usar tus apps (Gmail, LinkedIn, Pinterest, Notion, Drive…): pega aquí tu clave y aparece la pestaña Conectores. Está en Composio → Settings → Sessions &amp; API Key (empieza por ck_); también vale la de un proyecto de desarrollador (ak_). Cada app se conecta en su propia página y Composio guarda ese acceso en tu cuenta; aquí solo queda la clave, cifrada.</p>
      ${keyField(KEY, 'Clave de API de Composio', { help: 'https://composio.dev', placeholder: 'ck_…' })}
      ${hasSecret(KEY) && view?.error ? `<p class="section-note danger">${esc(view.error)}</p>` : ''}
    </section>`;
}

/** The Composio part of Ajustes → Conectores: what's connected, then the catalog. */
export function appsPanel(): string {
  // The key was just saved or removed: ask again.
  if (view && view.key !== hasSecret(KEY)) {
    view = { ...view, key: hasSecret(KEY) };
    void loadApps().then(() => document.dispatchEvent(new Event('apps-change')));
  }
  return `
    ${view?.error ? `<p class="section-note danger">${esc(view.error)}</p>` : ''}
    ${note ? `<p class="section-note" role="status">${esc(note)}</p>` : ''}
    ${view ? `${connected()}${catalogView()}` : '<p class="section-note">Cargando tus apps…</p>'}`;
}

/** After opening an app's sign-in page: look every few seconds until it's connected (two minutes at most). */
function watchConnections(render: () => void): void {
  clearInterval(watch);
  watch = window.setInterval(async () => {
    await loadApps();
    for (const [slug, since] of waiting) {
      if (conn(slug)?.status === 'active') {
        waiting.delete(slug);
        note = `${info(slug)?.name ?? slug} conectada: el equipo ya puede usarla.`;
      } else if (Date.now() - since > 120_000) waiting.delete(slug);
    }
    if (!waiting.size) clearInterval(watch);
    render();
  }, 3000);
}

export async function appsClick(t: HTMLElement, render: () => void): Promise<boolean> {
  const on = t.closest<HTMLElement>('[data-app-connect]');
  if (on) {
    const slug = on.dataset.appConnect!;
    // Opened right away (on the click), so the browser doesn't block it; filled in once we have the address.
    const tab = window.open('about:blank', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/api/apps/${slug}/connect`, 'POST');
      // The sign-in page gets no handle back on the office.
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
      else window.open(url, '_blank', 'noopener');
      waiting.set(slug, Date.now());
      note = `Da permiso en la página de ${info(slug)?.name ?? slug} que se ha abierto; esto se actualiza solo.`;
      watchConnections(render);
    } catch (e) {
      tab?.close();
      note = e instanceof Error ? e.message : 'No se pudo conectar';
    }
    render();
    return true;
  }
  const off = t.closest<HTMLElement>('[data-app-off]');
  if (off) {
    const slug = off.dataset.appOff!;
    if (confirmOff !== slug) {
      confirmOff = slug;
      render();
      return true;
    }
    confirmOff = '';
    try {
      view = await api<AppsView>(`/api/apps/${slug}`, 'DELETE');
      note = `${info(slug)?.name ?? slug} desconectada.`;
    } catch (e) {
      note = e instanceof Error ? e.message : 'No se pudo desconectar';
    }
    render();
    return true;
  }
  if (t.closest('[data-app-more]')) {
    shown += PAGE;
    render();
    return true;
  }
  if (t.closest('[data-app-refresh]')) {
    list = null;
    render();
    await loadCatalog(true);
    render();
    return true;
  }
  return false;
}

export async function appsChange(t: HTMLInputElement | HTMLSelectElement, render: () => void): Promise<boolean> {
  if (t.dataset.appAccess) {
    try {
      view = await api<AppsView>(`/api/apps/${t.dataset.appAccess}/access`, 'PUT', { access: t.value });
    } catch (e) {
      note = e instanceof Error ? e.message : 'No se pudo guardar';
    }
    render();
    return true;
  }
  if (t.matches('[data-app-cat]')) {
    category = t.value;
    shown = PAGE;
    render();
    return true;
  }
  return false;
}

/** Typing in the search box: the grid follows, the box keeps its focus. */
export function appsInput(t: HTMLInputElement, render: () => void): boolean {
  if (!t.matches('[data-app-query]')) return false;
  query = t.value;
  shown = PAGE;
  const at = t.selectionStart;
  render();
  const box = document.querySelector<HTMLInputElement>('[data-app-query]');
  box?.focus();
  if (box && at !== null) box.setSelectionRange(at, at);
  return true;
}
