import { ITEM_ACTS, ITEM_KINDS, onTheWay } from '../sim/items';
import { ROLES } from '../sim/seed';
import { archiveItem, askItemChanges, fileUrl, getState, seeItems, starItem, task, worker } from '../sim/store';
import type { Item, ItemKind, Worker } from '../sim/types';
import { esc, stamp } from './dom';
import { icon } from './icons';

/**
 * What the team makes or finds. «Entregas» is yours: what reached you, filtered and improved
 * on the way up. «Inventario», in someone's file, is theirs: what they've made, where it is
 * now, and what their people passed them to review.
 */

const KIND_ICON: Record<ItemKind, (s?: number) => string> = {
  doc: icon.doc,
  image: icon.image,
  link: icon.link,
  reference: icon.bookmark,
  code: icon.code,
  copy: icon.text,
  prompt: icon.sparkles,
  data: icon.sheet,
  idea: icon.idea,
  plan: icon.plan,
  report: icon.chart,
  contact: icon.contact,
  tool: icon.wrench,
  budget: icon.coins,
  palette: icon.palette,
};

let filter: ItemKind | 'all' | 'star' = 'all';
let showArchived = false;
/** Texts opened whole, and the item whose «Pedir cambios» box is open. */
const opened = new Set<string>();
let asking: string | null = null;
/** New when you opened Entregas: they keep their mark while you're looking. */
const fresh = new Set<string>();

const lastAt = (i: Item) => i.trail[i.trail.length - 1]?.at ?? i.at;
const nameOf = (id: string) => (id === 'owner' ? 'tú' : (worker(id)?.name ?? 'alguien que ya no está'));

function dot(id: string): string {
  const w = worker(id);
  return `<span class="talk-dot" style="--role:${w ? ROLES[w.role].color : '#999'}" aria-hidden="true">${esc((w?.name ?? '?').charAt(0))}</span>`;
}

/** Who it went through: «Víctor → Óscar (lo mejoró) → Marta → ti». */
function path(i: Item): string {
  const hops: string[] = [];
  for (const s of i.trail) {
    if (s.act === 'made' || s.act === 'redo') {
      hops.length = 0;
      hops.push(esc(nameOf(s.by)));
    } else if (s.act === 'up' || s.act === 'better') hops.push(`${esc(nameOf(s.by))}${s.act === 'better' ? ' <em>(lo mejoró)</em>' : ''}`);
  }
  if (i.holder === 'owner' && i.trail.some((s) => s.act === 'sent')) return `${esc(nameOf(i.by))} → ti, por el chat`;
  if (i.holder === 'owner') hops.push('ti');
  return hops.join(' → ');
}

/** Where it is now, for its maker's inventory. */
function where(i: Item): { label: string; tone: string } {
  const last = i.trail[i.trail.length - 1];
  switch (i.status) {
    case 'held':
      return { label: 'Borrador', tone: '' };
    case 'review':
      return { label: `En revisión con ${nameOf(i.holder)}`, tone: 'is-warn' };
    case 'back':
      return { label: `Devuelto por ${last?.by === 'owner' ? 'ti' : nameOf(last?.by ?? '')}`, tone: 'is-bad' };
    case 'delivered':
    case 'archived':
      return { label: 'Te ha llegado', tone: 'is-ok' };
    case 'dropped':
      return { label: `Descartado por ${nameOf(last?.by ?? '')}`, tone: 'is-muted' };
    case 'replaced':
      return { label: 'Sustituido por otra versión', tone: 'is-muted' };
  }
}

function preview(i: Item): string {
  const pics = (i.files ?? []).filter((f) => f.kind === 'image');
  const docs = (i.files ?? []).filter((f) => f.kind === 'doc');
  const apps = i.images ?? [];
  const thumbs = [
    ...pics.slice(0, 4).map((f) => `<button class="item-thumb" type="button" data-item-act="view" data-file="${f.id}" aria-label="Ver ${esc(f.name)}"><img data-file-src="${f.id}" alt=""></button>`),
    ...apps.slice(0, 4 - Math.min(4, pics.length)).map((im) => `<a class="item-thumb" href="${esc(safe(im.link ?? im.url))}" target="_blank" rel="noopener noreferrer"><img src="${esc(safe(im.url))}" alt="${esc(im.title ?? '')}" referrerpolicy="no-referrer" loading="lazy"></a>`),
  ];
  const more = pics.length + apps.length - thumbs.length;
  const long = i.text.length > 320 || i.text.split('\n').length > 6;
  return `
    ${thumbs.length ? `<div class="item-thumbs">${thumbs.join('')}${more > 0 ? `<span class="meta">+${more}</span>` : ''}</div>` : ''}
    ${
      i.text
        ? `<div class="item-text${i.kind === 'code' || i.kind === 'data' ? ' is-mono' : ''}${long && !opened.has(i.id) ? ' is-clamped' : ''}">${esc(i.text)}</div>
           ${long ? `<button class="link item-more" type="button" data-item-act="more" data-item="${i.id}">${opened.has(i.id) ? 'Ver menos' : 'Ver entero'}</button>` : ''}`
        : ''
    }
    ${i.url ? `<a class="item-url" href="${esc(safe(i.url))}" target="_blank" rel="noopener noreferrer">${icon.external(13)}<span>${esc(host(i.url))}</span></a>` : ''}
    ${docs.map((f) => `<button class="item-file" type="button" data-item-act="download" data-file="${f.id}" data-name="${esc(f.name)}">${icon.download(13)}<span>${esc(f.name)}</span></button>`).join('')}`;
}

/** Only web addresses become links. */
const safe = (u: string) => (/^https?:\/\//i.test(u) ? u : '#');
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

function trail(i: Item): string {
  if (i.trail.length < 2 && !i.trail.some((s) => s.note)) return '';
  return `
    <details class="item-trail">
      <summary>Recorrido</summary>
      <ol>${i.trail
        .map(
          (s) =>
            `<li>${s.by === 'owner' ? '' : dot(s.by)}<span><strong>${esc(s.by === 'owner' ? 'Tú' : nameOf(s.by))}</strong> ${ITEM_ACTS[s.act]}${s.note ? `: ${esc(s.note)}` : ''} <span class="meta num">${stamp(s.at)}</span></span></li>`,
        )
        .join('')}</ol>
    </details>`;
}

/** One piece. `mine`: it's yours (in Entregas), with what you can do with it. */
function card(i: Item, mine: boolean): string {
  const t = task(i.taskId);
  const st = mine ? null : where(i);
  const isNew = mine && (i.unseen || fresh.has(i.id));
  const acts = mine
    ? [
        i.text ? `<button class="btn btn-sm btn-ghost" type="button" data-item-act="copy" data-item="${i.id}">${icon.copy(13)}Copiar</button>` : '',
        i.status === 'delivered' ? `<button class="btn btn-sm btn-ghost" type="button" data-item-act="ask" data-item="${i.id}" aria-expanded="${asking === i.id}">${icon.undo(13)}Pedir cambios</button>` : '',
        i.status === 'delivered'
          ? `<button class="btn btn-sm btn-ghost" type="button" data-item-act="archive" data-item="${i.id}">${icon.archive(13)}Archivar</button>`
          : `<button class="btn btn-sm btn-ghost" type="button" data-item-act="unarchive" data-item="${i.id}">${icon.unarchive(13)}Recuperar</button>`,
      ].join('')
    : '';
  return `
    <article class="item${isNew ? ' is-new' : ''}${i.status === 'dropped' || i.status === 'replaced' ? ' is-gone' : ''}" data-key="item-${i.id}">
      <header class="item-head">
        <span class="item-kind">${KIND_ICON[i.kind](13)}${ITEM_KINDS[i.kind].label}${i.v > 1 ? ` · v${i.v}` : ''}</span>
        ${isNew ? '<span class="item-new">Nuevo</span>' : ''}
        ${st ? `<span class="item-where ${st.tone}">${esc(st.label)}</span>` : ''}
        <span class="meta num">${stamp(lastAt(i))}</span>
        ${
          mine
            ? `<button class="btn btn-icon btn-sm item-star${i.starred ? ' is-on' : ''}" type="button" data-item-act="star" data-item="${i.id}" aria-pressed="${!!i.starred}" aria-label="${i.starred ? 'Quitar de destacadas' : 'Destacar'}">${icon.star(15)}</button>`
            : ''
        }
      </header>
      <h3 class="item-title">${esc(i.title)}</h3>
      ${preview(i)}
      <p class="item-path">${dot(i.by)}<span>${path(i)}${t ? ` · <span class="meta-inline">«${esc(t.title)}»</span>` : ''}</span></p>
      ${trail(i)}
      ${acts ? `<div class="item-actions">${acts}</div>` : ''}
      ${
        mine && asking === i.id
          ? `<form class="item-ask" data-item-ask="${i.id}">
               <label class="sr-only" for="ask-${i.id}">Qué cambiarías</label>
               <textarea id="ask-${i.id}" rows="2" maxlength="2000" placeholder="Qué cambiarías: ${esc(nameOf(i.by))} lo rehace y vuelve a subir" data-key="ask-${i.id}"></textarea>
               <div class="item-actions"><button class="btn btn-sm btn-primary" type="submit">${icon.send(13)}Enviar a ${esc(nameOf(i.by))}</button><button class="btn btn-sm btn-ghost" type="button" data-item-act="ask" data-item="${i.id}">Cancelar</button></div>
             </form>`
          : ''
      }
    </article>`;
}

export const unseenItems = () => getState().items.filter((i) => i.unseen).length;

/** «Entregas»: what reached you, newest first, by kind; and what's still on its way. */
export function renderItems(): string {
  const all = getState().items;
  const yours = all.filter((i) => i.holder === 'owner' && (showArchived ? i.status === 'archived' : i.status === 'delivered'));
  const archived = all.filter((i) => i.holder === 'owner' && i.status === 'archived').length;
  const coming = all.filter(onTheWay);
  const kinds = [...new Set(yours.map((i) => i.kind))];
  if (filter !== 'all' && filter !== 'star' && !kinds.includes(filter)) filter = 'all';
  const shown = yours.filter((i) => filter === 'all' || (filter === 'star' ? i.starred : i.kind === filter)).sort((a, b) => lastAt(b) - lastAt(a));
  const byHolder = new Map<string, number>();
  for (const i of coming.filter((x) => x.status === 'review')) byHolder.set(i.holder, (byHolder.get(i.holder) ?? 0) + 1);
  const back = coming.filter((i) => i.status === 'back').length;
  const drafts = coming.filter((i) => i.status === 'held').length;
  const way = [
    ...[...byHolder].map(([id, n]) => `${n} en revisión con ${esc(nameOf(id))}`),
    back ? `${back} devuelta${back > 1 ? 's' : ''} para rehacer` : '',
    drafts ? `${drafts} borrador${drafts > 1 ? 'es' : ''}` : '',
  ].filter(Boolean);
  const chip = (id: typeof filter, label: string, n: number) =>
    `<button class="chip" type="button" data-item-filter="${id}" aria-pressed="${filter === id}">${label}<span class="chip-meta num">${n}</span></button>`;
  return `
    <p class="section-note">Lo que el equipo hace o encuentra (documentos, imágenes, enlaces, prompts, contactos…). Cada pieza sube por su responsable, que la revisa, la mejora o la devuelve, y te llega filtrada.</p>
    ${way.length ? `<p class="items-way">${icon.box(14)}<span>En camino: ${way.join(' · ')}</span></p>` : ''}
    ${
      yours.length
        ? `<div class="chips items-filter" role="group" aria-label="Filtrar">
             ${chip('all', 'Todas', yours.length)}
             ${yours.some((i) => i.starred) ? chip('star', 'Destacadas', yours.filter((i) => i.starred).length) : ''}
             ${kinds.map((k) => chip(k, ITEM_KINDS[k].label, yours.filter((i) => i.kind === k).length)).join('')}
           </div>
           <div class="items">${shown.map((i) => card(i, true)).join('')}</div>`
        : `<p class="items-empty">${showArchived ? 'No tienes nada archivado.' : coming.length ? 'Aún no te ha llegado nada: lo primero está en revisión.' : 'Aún no te ha llegado nada. En cuanto alguien termine algo que sirva, lo verás aquí.'}</p>`
    }
    ${archived || showArchived ? `<button class="link items-archived" type="button" data-item-act="archived">${showArchived ? 'Volver a tus entregas' : `Archivadas (${archived})`}</button>` : ''}`;
}

/** «Inventario» in someone's file: what they were passed to review, and what they've made. */
export function inventoryPane(w: Worker): string {
  const all = getState().items;
  const toReview = all.filter((i) => i.status === 'review' && i.holder === w.id);
  const made = all.filter((i) => i.by === w.id && i.status !== 'replaced').sort((a, b) => lastAt(b) - lastAt(a));
  const boss = worker(w.reportsTo);
  return `
    ${
      toReview.length
        ? `<section class="section"><h2 class="section-title">Por revisar <span class="count">${toReview.length}</span></h2>
             <p class="section-note">Su gente se lo ha pasado: lo revisa, lo mejora o lo devuelve antes de que siga hacia ${boss ? esc(boss.name) : 'ti'}.</p>
             <div class="items">${toReview.map((i) => card(i, false)).join('')}</div></section>`
        : ''
    }
    <section class="section"><h2 class="section-title">Hecho por ${esc(w.name)}${made.length ? ` <span class="count">${made.length}</span>` : ''}</h2>
      ${
        made.length
          ? `<div class="items">${made.map((i) => card(i, false)).join('')}</div>`
          : `<p class="section-note">Aún no ha guardado nada. Lo que haga en su mesa (textos, imágenes, enlaces, prompts…) aparecerá aquí y subirá a ${boss ? esc(boss.name) : 'ti'} para revisión.</p>`
      }
    </section>`;
}

/** Pictures load with the session's token, after each render. */
export function hydrateItems(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('.item img[data-file-src]')) {
    if (img.getAttribute('src')) continue;
    void fileUrl(img.dataset.fileSrc!).then((url) => (img.src = url)).catch(() => img.closest('.item-thumb')?.remove());
  }
}

/** Looking at Entregas counts as seeing what's new (it keeps its mark while you're there). */
export function seeNewItems(): void {
  const ids = getState().items.filter((i) => i.unseen).map((i) => i.id);
  if (!ids.length) return;
  for (const id of ids) fresh.add(id);
  seeItems(ids);
}

/** Leaving Entregas: the marks go. */
export function forgetFresh(): void {
  fresh.clear();
}

export function bindItems(rerender: () => void): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const f = target.closest<HTMLElement>('[data-item-filter]');
    if (f) {
      filter = f.dataset.itemFilter as typeof filter;
      return rerender();
    }
    const b = target.closest<HTMLElement>('[data-item-act]');
    if (!b) return;
    const id = b.dataset.item ?? '';
    const i = getState().items.find((x) => x.id === id);
    switch (b.dataset.itemAct) {
      case 'more':
        if (opened.has(id)) opened.delete(id);
        else opened.add(id);
        return rerender();
      case 'star':
        if (i) starItem(id, !i.starred);
        return;
      case 'archive':
        return archiveItem(id, true);
      case 'unarchive':
        return archiveItem(id, false);
      case 'archived':
        showArchived = !showArchived;
        return rerender();
      case 'ask':
        asking = asking === id ? null : id;
        rerender();
        if (asking) document.querySelector<HTMLTextAreaElement>(`#ask-${CSS.escape(id)}`)?.focus();
        return;
      case 'copy':
        if (i)
          void navigator.clipboard.writeText(i.url ? `${i.title}\n${i.text}\n${i.url}` : i.text).then(() => {
            b.innerHTML = `${icon.tick(13)}Copiado`;
            setTimeout(() => (b.innerHTML = `${icon.copy(13)}Copiar`), 1500);
          });
        return;
      case 'view':
        void fileUrl(b.dataset.file!).then((url) => window.open(url, '_blank', 'noopener'));
        return;
      case 'download':
        void fileUrl(b.dataset.file!).then((url) => {
          const a = document.createElement('a');
          a.href = url;
          a.download = b.dataset.name ?? 'archivo';
          a.click();
        });
        return;
    }
  });
  document.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-item-ask]');
    if (!form) return;
    e.preventDefault();
    const box = form.querySelector('textarea')!;
    const text = box.value.trim();
    if (text.length < 2) return box.focus();
    askItemChanges(form.dataset.itemAsk!, text);
    asking = null;
    box.blur();
    rerender();
  });
}
