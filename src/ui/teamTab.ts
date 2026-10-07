import { ROLES, ROLE_ORDER } from '../sim/seed';
import {
  assignTask,
  getSelectedId,
  getState,
  select,
  sendCoffee,
  setPair,
  setStatus,
  task,
  unblock,
  worker,
} from '../sim/store';
import type { Task, Worker } from '../sim/types';
import { bar, esc, fill, pct, roleDot, stamp } from './dom';
import { ACTIVITY_LABEL, activityIcon, feedIcon, icon } from './icons';
import { openLookEditor } from './lookEditor';
import { openTaskDialog } from './taskDialog';

function currentShown(w: Worker): Task | undefined {
  if (w.activity === 'reviewing') return getState().tasks.find((t) => t.status === 'review');
  return task(w.taskId);
}

function shownProgress(w: Worker, t: Task | undefined) {
  if (!t) return 0;
  return w.activity === 'reviewing' ? t.reviewProgress : t.progress;
}

const initial = (w: Worker) =>
  `<span class="avatar" style="--role:${ROLES[w.role].color}" aria-hidden="true">${esc(w.name[0])}</span>`;

function statusPill(w: Worker): string {
  return `<span class="status status-${w.activity}">${activityIcon(w.activity, w.role, 13)}${ACTIVITY_LABEL[w.activity]}</span>`;
}

function renderList(): string {
  const s = getState();
  const rows = s.workers
    .map((w) => {
      const t = currentShown(w);
      const partner = worker(w.pairWith);
      const sub = t
        ? esc(t.title)
        : w.activity === 'idle'
          ? 'Buscando la siguiente tarea'
          : ACTIVITY_LABEL[w.activity];
      return `
      <li>
        <button class="person" type="button" style="--role:${ROLES[w.role].color}" data-select="${w.id}" data-key="p-${w.id}">
          ${initial(w)}
          <span class="person-main">
            <span class="person-head">
              <span class="person-name">${esc(w.name)}</span>
              <span class="person-title">${esc(w.title)}</span>
            </span>
            <span class="person-task">${sub}${partner && w.activity === 'pairing' ? ` <span class="muted">· con ${esc(partner.name)}</span>` : ''}</span>
            ${t ? `<span class="person-progress">${bar(t.id, shownProgress(w, t))}<span class="num" data-pct="${t.id}">${pct(shownProgress(w, t))}</span></span>` : ''}
          </span>
          ${statusPill(w)}
        </button>
      </li>`;
    })
    .join('');

  const open = (r: string) =>
    s.tasks.filter((t) => t.role === r && t.status !== 'done').length;
  const max = Math.max(1, ...ROLE_ORDER.map(open));
  const load = ROLE_ORDER.map(
    (r) => `
      <li>
        <span class="load-label">${roleDot(r)}${ROLES[r].label}</span>
        <span class="bar bar-load"><i style="width:${(open(r) / max) * 100}%;--role:${ROLES[r].color}"></i></span>
        <span class="num">${open(r)}</span>
      </li>`,
  ).join('');

  return `
    <ul class="people" aria-label="Equipo">${rows}</ul>
    <section class="section">
      <h2 class="section-title">Carga por rol</h2>
      <p class="section-note">Tareas abiertas (pendientes, en curso, bloqueadas y en revisión).</p>
      <ul class="load">${load}</ul>
    </section>`;
}

function renderDetail(w: Worker): string {
  const s = getState();
  const t = currentShown(w);
  const own = task(w.taskId);
  const partner = worker(w.pairWith);
  const role = ROLES[w.role];

  const backlog = s.tasks
    .filter((x) => x.status === 'backlog')
    .sort((a, b) => Number(b.role === w.role) - Number(a.role === w.role) || a.createdAt - b.createdAt);
  const options = backlog
    .map((x) => `<option value="${x.id}">${esc(x.title)}${x.role !== w.role ? ` (${ROLES[x.role].label})` : ''}</option>`)
    .join('');

  const partners = s.workers
    .filter((o) => o.id !== w.id && !o.pairWith)
    .map((o) => `<option value="${o.id}" ${o.id === w.pairWith ? 'selected' : ''}>${esc(o.name)} · ${esc(o.title)}</option>`)
    .join('');

  const history = s.tasks
    .filter((x) => x.status === 'done' && x.assigneeId === w.id)
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .slice(0, 5);
  const events = s.feed.filter((e) => e.workerId === w.id).slice(0, 6);

  let taskBlock: string;
  if (t) {
    const progress = shownProgress(w, t);
    taskBlock = `
      <div class="current" style="--role:${ROLES[t.role].color}">
        <div class="current-head">
          <span class="label">${w.activity === 'reviewing' ? 'Revisando' : 'Tarea actual'}</span>
          <button class="btn btn-icon" type="button" data-edit="${t.id}" data-key="edit-${t.id}" aria-label="Editar tarea">${icon.edit(15)}</button>
        </div>
        <p class="current-title">${esc(t.title)}</p>
        <div class="current-progress">${bar(t.id, progress, 'bar-lg')}<span class="num" data-pct="${t.id}">${pct(progress)}</span></div>
        <p class="meta">${roleDot(t.role)}${ROLES[t.role].label} · estimación ${t.estimate} h${
          t.status === 'blocked' && t.blockReason ? ` · <span class="danger">${esc(t.blockReason)}</span>` : ''
        }</p>
      </div>`;
  } else {
    taskBlock = `
      <div class="current current-empty">
        <p class="current-title">Sin tarea asignada</p>
        <p class="meta">Si hay algo pendiente de ${role.label.toLowerCase()}, lo cogerá solo. También puedes asignarle una abajo.</p>
      </div>`;
  }

  const blocked = own?.status === 'blocked';
  const away = w.activity === 'coffee' || w.activity === 'meeting';

  return `
    <button class="btn btn-ghost back" type="button" data-back data-key="back">${icon.back(16)}Equipo</button>
    <header class="detail-head">
      <span class="avatar avatar-lg" style="--role:${role.color}" aria-hidden="true">${esc(w.name[0])}</span>
      <div>
        <h2 class="detail-name">${esc(w.name)}</h2>
        <p class="detail-title">${esc(w.title)} · ${roleDot(w.role)}${role.label}</p>
      </div>
    </header>

    <div class="detail-status">
      ${statusPill(w)}
      ${partner ? `<span class="muted">con ${esc(partner.name)}</span>` : ''}
      <span class="energy" title="Energía">Energía <span class="bar bar-thin"><i data-energy="${w.id}" style="transform:${fill(w.energy)}"></i></span><span class="num" data-energy-pct="${w.id}">${pct(w.energy)}</span></span>
    </div>

    ${taskBlock}

    <div class="actions">
      ${
        blocked
          ? `<button class="btn" type="button" data-unblock="${own!.id}" data-key="unblock">${icon.check(15)}Desbloquear</button>`
          : own
            ? `<button class="btn" type="button" data-block="${own.id}" data-key="block">${icon.alert(15)}Marcar bloqueo</button>`
            : ''
      }
      <button class="btn" type="button" data-coffee="${w.id}" data-key="coffee" ${away ? 'disabled' : ''}>${icon.coffee(15)}Pausa café</button>
      <button class="btn" type="button" data-look-edit="${w.id}" data-key="look">${icon.shirt(15)}Personalizar aspecto</button>
    </div>

    <section class="section">
      <h3 class="section-title">Asignar tarea</h3>
      ${
        backlog.length
          ? `<form class="inline-form" data-assign="${w.id}">
              <label class="sr-only" for="assign-${w.id}">Tarea pendiente</label>
              <select id="assign-${w.id}" name="task" data-key="assign-select">${options}</select>
              <button class="btn btn-primary" type="submit" data-key="assign-go">Asignar</button>
            </form>
            <p class="section-note">Su tarea actual vuelve a pendientes con el progreso que lleve.</p>`
          : `<p class="section-note">No hay tareas pendientes. Crea una en la pestaña Tareas.</p>`
      }
    </section>

    <section class="section">
      <h3 class="section-title"><label for="pair-${w.id}">Colabora con</label></h3>
      <select id="pair-${w.id}" data-pair="${w.id}" data-key="pair-select">
        <option value="">Nadie, trabaja en su mesa</option>
        ${partners}
      </select>
      <p class="section-note">Se sienta en la mesa de esa persona y ambos avanzan un 25% más rápido.</p>
    </section>

    <section class="section">
      <h3 class="section-title">Historial</h3>
      ${
        history.length
          ? `<ul class="history">${history
              .map((x) => `<li>${icon.check(14)}<span>${esc(x.title)}</span><span class="num muted">${stamp(x.doneAt!)}</span></li>`)
              .join('')}</ul>`
          : `<p class="section-note">Todavía no ha cerrado ninguna tarea en esta simulación.</p>`
      }
      ${
        events.length
          ? `<ul class="feed feed-compact">${events
              .map((e) => `<li><span class="feed-icon feed-${e.kind}">${feedIcon(e.kind, 13)}</span><span>${esc(e.text)}</span><span class="num muted">${stamp(e.t)}</span></li>`)
              .join('')}</ul>`
          : ''
      }
    </section>`;
}

export function renderTeam(): string {
  const w = worker(getSelectedId());
  return w ? renderDetail(w) : renderList();
}

export function bindTeam(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const sel = target.closest<HTMLElement>('[data-select]');
    if (sel) return select(sel.dataset.select!);
    if (target.closest('[data-back]')) return select(null);
    const edit = target.closest<HTMLElement>('[data-edit]');
    if (edit) return openTaskDialog(edit.dataset.edit!);
    const un = target.closest<HTMLElement>('[data-unblock]');
    if (un) {
      const t = task(un.dataset.unblock!);
      if (t) unblock(t);
      return;
    }
    const bl = target.closest<HTMLElement>('[data-block]');
    if (bl) return setStatus(bl.dataset.block!, 'blocked');
    const lk = target.closest<HTMLElement>('[data-look-edit]');
    if (lk) return openLookEditor(lk.dataset.lookEdit!);
    const cf = target.closest<HTMLElement>('[data-coffee]');
    if (cf) return sendCoffee(cf.dataset.coffee!);
  });
  el.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-assign]');
    if (!form) return;
    e.preventDefault();
    const id = new FormData(form).get('task');
    if (typeof id === 'string' && id) assignTask(id, form.dataset.assign!);
  });
  el.addEventListener('change', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-pair]');
    if (s) {
      setPair(s.dataset.pair!, s.value || null);
      s.blur();
    }
  });
}
