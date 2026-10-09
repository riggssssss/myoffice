import { ROLES } from '../sim/seed';
import { getState, placeTask, select, setStatus, worker } from '../sim/store';
import type { Task, Worker } from '../sim/types';
import { bar, esc, pct, stamp } from './dom';
import { linkDossier } from './dossier';
import { icon } from './icons';
import { openTaskDialog } from './taskDialog';
import { kpis } from './topbar';

/**
 * Tasks, person by person: each one's line in the order they'll do it. The first is what they're
 * on now; drag to reorder (or to hand it to someone else) and whatever ends up first becomes the
 * active one. What goes back keeps its progress. A task opens in place for its details.
 */

/** Tasks opened in place (kept across redraws). */
const open = new Set<string>();
let doneOpen = false;
/** The task being dragged, if any. */
let dragging: string | null = null;

const unfinished = (t: Task) => t.status === 'backlog' || t.status === 'doing' || t.status === 'blocked';

/** Someone's line: what they're on first, then their queue in order. */
function lineOf(w: Worker, tasks: Task[]): Task[] {
  const mine = tasks.filter((t) => t.assigneeId === w.id && !t.ongoing && unfinished(t));
  const current = mine.find((t) => t.id === w.taskId);
  const rest = mine.filter((t) => t !== current).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt - b.createdAt);
  return current ? [current, ...rest] : rest;
}

const face = (w: Worker) => `<span class="talk-dot" style="--role:${ROLES[w.role].color}" aria-hidden="true">${esc(w.name.charAt(0))}</span>`;
/** Internal ids (t33) mean nothing to you. */
const plain = (s: string) => s.replace(/\(?\bt\d{1,6}\b\)?:?\s?/g, '').replace(/\s{2,}/g, ' ').trim();

// ---------------------------------------------------------------- one task

function details(t: Task, line: Task[], laneId: string | null): string {
  const i = line.indexOf(t);
  const owner = worker(t.assigneeId);
  const notes = t.notes.slice(-2).reverse();
  const move = (to: number) => {
    const order = line.map((x) => x.id).filter((id) => id !== t.id);
    order.splice(to, 0, t.id);
    return order.join(',');
  };
  return `
    <div class="tq-more">
      ${t.status === 'blocked' && t.blockReason ? `<p class="tq-block">${icon.alert(14)}<span>${esc(plain(t.blockReason))}</span></p>` : ''}
      ${
        notes.length
          ? `<ol class="tq-notes">${notes
              .map((n) => `<li><span class="tq-note-head">${esc(worker(n.by)?.name ?? 'Alguien')} · <span class="num">${stamp(n.at)}</span></span><span class="tq-note-text">${linkDossier(esc(plain(n.text)))}</span></li>`)
              .join('')}</ol>`
          : `<p class="tq-quiet">${t.status === 'review' ? 'Esperando revisión.' : t.progress > 0 ? 'Sin notas de avance.' : 'Aún sin empezar.'}</p>`
      }
      <p class="tq-facts">${ROLES[t.role].label} · ${t.ongoing ? 'continua' : `${t.estimate} h estimadas`} · creada ${stamp(t.createdAt)}${t.notes.length > 2 ? ` · ${t.notes.length} entregas` : ''}</p>
      <div class="tq-actions">
        <button class="btn btn-sm" type="button" data-tq-edit="${t.id}">${icon.edit(13)}Editar</button>
        ${t.status === 'blocked' ? `<button class="btn btn-sm" type="button" data-tq-status="${t.id}" data-to="doing">Desbloquear</button>` : t.status === 'doing' ? `<button class="btn btn-sm btn-ghost" type="button" data-tq-status="${t.id}" data-to="blocked">Bloquear</button>` : ''}
        ${t.status === 'review' ? `<button class="btn btn-sm" type="button" data-tq-status="${t.id}" data-to="done">${icon.tick(13)}Dar por hecha</button>` : ''}
        ${
          laneId && i >= 0 && line.length > 1
            ? `<span class="tq-move">
                <button class="btn btn-icon btn-sm btn-ghost" type="button" data-tq-place="${t.id}" data-lane="${laneId}" data-order="${move(Math.max(0, i - 1))}" ${i === 0 ? 'disabled' : ''} aria-label="Subir en la cola">${icon.send(13)}</button>
                <button class="btn btn-icon btn-sm btn-ghost tq-down" type="button" data-tq-place="${t.id}" data-lane="${laneId}" data-order="${move(i + 1)}" ${i === line.length - 1 ? 'disabled' : ''} aria-label="Bajar en la cola">${icon.send(13)}</button>
              </span>`
            : ''
        }
        ${owner && !t.ongoing && unfinished(t) ? `<button class="btn btn-sm btn-ghost" type="button" data-tq-place="${t.id}" data-lane="" data-order="">Quitar a ${esc(owner.name)}</button>` : ''}
      </div>
    </div>`;
}

function row(t: Task, line: Task[], laneId: string | null, pos: 'now' | number | 'review' | 'ongoing' | 'loose'): string {
  const isOpen = open.has(t.id);
  const draggable = pos !== 'review' && pos !== 'ongoing';
  const blocked = t.status === 'blocked';
  const lead =
    pos === 'now'
      ? `<span class="tq-pos is-now" title="Lo que hace ahora">${blocked ? icon.alert(13) : '<i></i>'}</span>`
      : pos === 'ongoing'
        ? `<span class="tq-pos is-loop">${icon.ongoing(13)}</span>`
        : pos === 'review'
          ? `<span class="tq-pos is-review">${icon.check(13)}</span>`
          : typeof pos === 'number'
            ? `<span class="tq-pos num">${pos}</span>`
            : '<span class="tq-pos"><i></i></span>';
  const sub = blocked
    ? `<span class="tq-sub is-bad">Bloqueada${t.blockReason ? ` · ${esc(plain(t.blockReason))}` : ''}</span>`
    : pos === 'now'
      ? `<span class="tq-sub">Ahora${t.notes.length ? ` · último avance ${stamp(t.notes[t.notes.length - 1].at)}` : ''}</span>`
      : pos === 'ongoing'
        ? `<span class="tq-sub">Continua · ${t.notes.length ? `entregó ${stamp(t.notes[t.notes.length - 1].at)}` : 'sin entregas aún'}</span>`
        : pos === 'review'
          ? '<span class="tq-sub">En revisión</span>'
          : pos === 'loose'
            ? `<span class="tq-sub">${ROLES[t.role].label} · ${t.estimate} h</span>`
            : t.progress > 0
              ? `<span class="tq-sub">En pausa · retoma al ${pct(t.progress)}</span>`
              : '';
  return `
    <li class="tq tq-${t.status}${isOpen ? ' is-open' : ''}${pos === 'now' ? ' is-now' : ''}" data-tq="${t.id}" data-key="tq-${t.id}" ${draggable ? 'draggable="true"' : ''}>
      <div class="tq-row">
        ${draggable ? `<span class="tq-grip" aria-hidden="true">${icon.grip(14)}</span>` : '<span class="tq-grip"></span>'}
        ${lead}
        <button class="tq-main" type="button" data-tq-open="${t.id}" aria-expanded="${isOpen}">
          <span class="tq-title">${esc(plain(t.title))}</span>
          ${sub}
        </button>
        ${
          t.ongoing || pos === 'review' || (pos !== 'now' && t.progress === 0)
            ? ''
            : `<span class="tq-side">${bar(t.id, t.progress)}<span class="num" data-pct="${t.id}">${pct(t.progress)}</span></span>`
        }
      </div>
      ${isOpen ? details(t, line, laneId) : ''}
    </li>`;
}

// ---------------------------------------------------------------- lines

function lane(w: Worker, tasks: Task[]): string {
  const line = lineOf(w, tasks);
  const review = tasks.filter((t) => t.assigneeId === w.id && t.status === 'review');
  const ongoing = tasks.filter((t) => t.assigneeId === w.id && t.ongoing && t.status !== 'done');
  const blocked = line.filter((t) => t.status === 'blocked').length;
  return `
    <section class="lane${w.enabled ? '' : ' is-off'}" data-lane-of="${w.id}" data-key="lane-${w.id}">
      <header class="lane-head">
        ${face(w)}
        <span class="lane-who"><span class="lane-name">${esc(w.name)}</span><span class="meta">${esc(w.title)}</span></span>
        <span class="lane-count">${blocked ? `<span class="lane-alert">${blocked} bloqueada${blocked > 1 ? 's' : ''}</span>` : ''}<span class="num">${line.length}</span></span>
      </header>
      <ol class="tq-list" data-drop="${w.id}">
        ${line.map((t, i) => row(t, line, w.id, i === 0 ? 'now' : i + 1)).join('')}
        ${line.length ? '' : '<li class="tq-empty">Sin tareas en cola. Arrastra una aquí.</li>'}
      </ol>
      ${review.length || ongoing.length ? `<ul class="tq-list tq-extra">${[...review.map((t) => row(t, line, w.id, 'review')), ...ongoing.map((t) => row(t, line, w.id, 'ongoing'))].join('')}</ul>` : ''}
    </section>`;
}

// ---------------------------------------------------------------- the tab

export function renderTasks(): string {
  const s = getState();
  const tasks = s.tasks;
  const k = kpis();
  const people = s.workers.filter((w) => tasks.some((t) => t.assigneeId === w.id && t.status !== 'done'));
  const free = s.workers.filter((w) => !people.includes(w) && w.enabled);
  const loose = tasks.filter((t) => !t.assigneeId && unfinished(t)).sort((a, b) => a.createdAt - b.createdAt);
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const summary = [
    `<span><b class="num">${k.doing}</b> en curso</span>`,
    k.blocked ? `<span class="is-bad"><b class="num">${k.blocked}</b> bloqueada${k.blocked > 1 ? 's' : ''}</span>` : '',
    k.review ? `<span><b class="num">${k.review}</b> en revisión</span>` : '',
    `<span><b class="num">${k.doneToday}</b> hecha${k.doneToday === 1 ? '' : 's'} hoy</span>`,
  ]
    .filter(Boolean)
    .join('');
  return `
    <div class="tq-top">
      <p class="tq-summary">${summary}</p>
      <button class="btn btn-primary btn-sm" type="button" data-new data-key="new-task">${icon.plus(14)}Nueva tarea</button>
    </div>
    ${
      people.length || loose.length
        ? `<p class="tq-hint">Arrastra para cambiar el orden: la primera de cada persona es la que hace ahora. Lo que vuelve a la cola guarda su avance.</p>`
        : `<p class="section-note">No hay tareas. Crea una o pídeselo a Organización.</p>`
    }
    ${people.map((w) => lane(w, tasks)).join('')}
    ${
      loose.length
        ? `<section class="lane is-loose" data-key="lane-loose">
            <header class="lane-head"><span class="lane-who"><span class="lane-name">Sin asignar</span><span class="meta">${s.ai.state === 'off' ? 'Organización las repartirá cuando tenga la IA' : 'Organización las reparte en sus rondas; arrástralas a alguien si quieres'}</span></span><span class="lane-count"><span class="num">${loose.length}</span></span></header>
            <ol class="tq-list" data-drop="">${loose.map((t) => row(t, loose, null, 'loose')).join('')}</ol>
          </section>`
        : ''
    }
    ${free.length ? `<p class="tq-free">Sin tareas: ${free.map((w) => `<button class="link" type="button" data-tq-free="${w.id}">${esc(w.name)}</button>`).join(', ')}.</p>` : ''}
    ${
      done.length
        ? `<details class="tq-done" data-key="done-group" ${doneOpen ? 'open' : ''}>
            <summary>${icon.check(14)}Hechas <span class="num">${done.length}</span></summary>
            <ul class="tq-done-list">${done
              .slice(0, 30)
              .map((t) => `<li><button type="button" data-tq-edit="${t.id}"><span>${esc(plain(t.title))}</span><span class="meta">${esc(worker(t.assigneeId)?.name ?? '—')} · <span class="num">${t.doneAt ? stamp(t.doneAt) : ''}</span></span></button></li>`)
              .join('')}</ul>
          </details>`
        : ''
    }`;
}

// ---------------------------------------------------------------- doing things

/** The line a drop lands in, with the dragged task placed where the pointer is. */
function dropOrder(list: HTMLElement, y: number): string[] {
  const rows = [...list.querySelectorAll<HTMLElement>(':scope > li.tq')].filter((li) => li.dataset.tq !== dragging);
  const at = rows.findIndex((li) => {
    const r = li.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  const ids = rows.map((li) => li.dataset.tq!);
  ids.splice(at < 0 ? ids.length : at, 0, dragging!);
  return ids;
}

function marker(list: HTMLElement | null, y: number): void {
  document.querySelectorAll('.tq.is-drop-before, .tq.is-drop-after, .tq-list.is-drop-end').forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-end'));
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>(':scope > li.tq')].filter((li) => li.dataset.tq !== dragging);
  const at = rows.find((li) => {
    const r = li.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (at) at.classList.add('is-drop-before');
  else list.classList.add('is-drop-end');
}

export function bindTasks(el: HTMLElement, rerender: () => void): void {
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-new]')) return openTaskDialog(null);
    const ed = target.closest<HTMLElement>('[data-tq-edit]');
    if (ed) return openTaskDialog(ed.dataset.tqEdit!);
    const st = target.closest<HTMLElement>('[data-tq-status]');
    if (st) return setStatus(st.dataset.tqStatus!, st.dataset.to as Task['status']);
    const pl = target.closest<HTMLElement>('[data-tq-place]');
    if (pl) {
      const order = pl.dataset.order ? pl.dataset.order.split(',') : [];
      placeTask(pl.dataset.tqPlace!, pl.dataset.lane || null, order);
      return;
    }
    const fr = target.closest<HTMLElement>('[data-tq-free]');
    if (fr) return select(fr.dataset.tqFree!);
    const op = target.closest<HTMLElement>('[data-tq-open]');
    if (op) {
      const id = op.dataset.tqOpen!;
      if (!open.delete(id)) open.add(id);
      return rerender();
    }
  });
  el.addEventListener(
    'toggle',
    (e) => {
      if ((e.target as HTMLElement).matches('details.tq-done')) doneOpen = (e.target as HTMLDetailsElement).open;
    },
    true,
  );
  el.addEventListener('dragstart', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li.tq[draggable="true"]');
    if (!li) return;
    dragging = li.dataset.tq!;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', dragging);
    // The row stays in place, faded, while its ghost travels.
    requestAnimationFrame(() => li.classList.add('is-dragging'));
  });
  el.addEventListener('dragover', (e) => {
    if (!dragging) return;
    const list = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
    if (!list) return marker(null, 0);
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    marker(list, e.clientY);
  });
  el.addEventListener('drop', (e) => {
    const list = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]');
    if (!dragging || !list) return;
    e.preventDefault();
    const lane = list.dataset.drop || null;
    placeTask(dragging, lane, lane ? dropOrder(list, e.clientY) : []);
  });
  el.addEventListener('dragend', () => {
    dragging = null;
    marker(null, 0);
    el.querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging'));
  });
}
