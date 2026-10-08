import { ROLES, ROLE_ORDER } from '../sim/seed';
import { queueOf } from '../sim/ops';
import { getState, worker } from '../sim/store';
import type { RoleId, Task, TaskStatus, WorkRequest } from '../sim/types';
import { bar, esc, pct, roleDot, stamp } from './dom';
import { linkDossier } from './dossier';
import { icon } from './icons';
import { openTaskDialog } from './taskDialog';
import { kpis } from './topbar';

const GROUPS: { status: TaskStatus; title: string; empty: string }[] = [
  { status: 'blocked', title: 'Bloqueadas', empty: 'Nada bloqueado ahora mismo.' },
  { status: 'doing', title: 'En curso', empty: 'Nadie está trabajando en ninguna tarea.' },
  { status: 'review', title: 'En revisión', empty: 'Nada esperando revisión.' },
  { status: 'backlog', title: 'Pendientes', empty: 'No hay tareas pendientes.' },
  { status: 'done', title: 'Hechas', empty: 'Aún no se ha terminado nada.' },
];

let filter: RoleId | 'all' = 'all';
let doneOpen = false;

/** Right-hand side of an ongoing job: no percentage, just how recent its last delivery is. */
function ongoingSide(t: Task): string {
  const last = t.notes[t.notes.length - 1];
  return `<span class="task-ongoing">${icon.ongoing(14)}<span class="num">${last ? stamp(last.at) : 'continua'}</span></span>`;
}

function row(t: Task): string {
  const who = worker(t.assigneeId);
  const value = t.progress;
  if (t.ongoing) {
    return `
    <li>
      <button class="task task-${t.status} task-is-ongoing" type="button" data-task="${t.id}" data-key="task-${t.id}">
        <span class="task-main">
          <span class="task-title">${esc(t.title)}</span>
          <span class="meta">${roleDot(t.role)}${ROLES[t.role].label} · ${who ? esc(who.name) : '<span class="muted">Sin asignar</span>'} · ${
            t.status === 'done' ? 'parada' : `${t.notes.length} entrega${t.notes.length === 1 ? '' : 's'}`
          }</span>
          ${t.status === 'blocked' && t.blockReason ? `<span class="meta danger">${esc(t.blockReason)}</span>` : ''}
        </span>
        ${t.status === 'done' ? `<span class="task-done">${icon.stop(16)}</span>` : ongoingSide(t)}
      </button>
    </li>`;
  }
  const queued = t.status === 'backlog' && who;
  const place = queued ? queueOf(getState().tasks, who).findIndex((x) => x.id === t.id) + 1 : 0;
  const assignee = who ? (queued ? `en cola de ${esc(who.name)}${place ? ` (n.º ${place})` : ''}` : esc(who.name)) : '<span class="muted">Sin asignar</span>';
  return `
    <li>
      <button class="task task-${t.status}" type="button" data-task="${t.id}" data-key="task-${t.id}">
        <span class="task-main">
          <span class="task-title">${esc(t.title)}</span>
          <span class="meta">${roleDot(t.role)}${ROLES[t.role].label} · ${assignee} · ${t.estimate} h</span>
          ${t.status === 'blocked' && t.blockReason ? `<span class="meta danger">${esc(t.blockReason)}</span>` : ''}
        </span>
        ${t.status === 'done' ? `<span class="task-done">${icon.check(16)}</span>` : `<span class="task-progress">${bar(t.id, value)}<span class="num" data-pct="${t.id}">${pct(value)}</span></span>`}
      </button>
    </li>`;
}

export function renderTasks(): string {
  const s = getState();
  const tasks = s.tasks.filter((t) => filter === 'all' || t.role === filter);
  const chips = (['all', ...ROLE_ORDER] as const)
    .map(
      (r) =>
        `<button type="button" class="chip" data-filter="${r}" aria-pressed="${filter === r}" data-key="f-${r}">${
          r === 'all' ? 'Todas' : `${roleDot(r)}${ROLES[r].label}`
        }</button>`,
    )
    .join('');

  // Ongoing jobs that are running get their own group; stopped ones end up with the done.
  const running = (t: Task) => t.ongoing && t.status !== 'done';
  const ongoing = tasks.filter(running);
  const ongoingGroup = ongoing.length
    ? `<section class="section group group-ongoing">
        <h2 class="section-title">Continuas <span class="count">${ongoing.length}</span></h2>
        <p class="section-note">No tienen final: siguen, con una entrega cada rato, hasta que las pares.</p>
        <ul class="tasks">${ongoing.map(row).join('')}</ul></section>`
    : '';
  const groups = GROUPS.map((g) => {
    const list = tasks
      .filter((t) => t.status === g.status && !running(t))
      .sort((a, b) =>
        g.status === 'done' ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : b.progress - a.progress || a.createdAt - b.createdAt,
      );
    const unassigned = g.status === 'backlog' && list.some((t) => !t.assigneeId);
    const note = unassigned
      ? `<p class="section-note">${s.ai.state === 'off' ? 'El Organizador repartirá las pendientes cuando tenga la IA conectada.' : 'El Organizador las repartirá en sus rondas.'} Puedes asignarlas o corregirlas tú cuando quieras.</p>`
      : '';
    const body = list.length ? `${note}<ul class="tasks">${list.map(row).join('')}</ul>` : `<p class="section-note">${g.empty}</p>`;
    if (g.status === 'done') {
      return `<details class="section group" data-key="done-group" ${doneOpen ? 'open' : ''}>
        <summary class="section-title">${g.title} <span class="count">${list.length}</span></summary>${body}</details>`;
    }
    if (g.status === 'blocked' && !list.length) return '';
    return `<section class="section group group-${g.status}">
      <h2 class="section-title">${g.title} <span class="count">${list.length}</span></h2>${body}</section>`;
  }).join('');

  const k = kpis();
  return `
    <dl class="task-stats">
      <div><dt>Hechas hoy</dt><dd class="num">${k.doneToday}</dd></div>
      <div><dt>En curso</dt><dd class="num">${k.doing}</dd></div>
      <div class="${k.blocked ? 'is-alert' : ''}"><dt>Bloqueadas</dt><dd class="num">${k.blocked}</dd></div>
      <div><dt>En revisión</dt><dd class="num">${k.review}</dd></div>
    </dl>
    ${requests()}
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Filtrar por rol">${chips}</div>
      <button class="btn btn-primary" type="button" data-new data-key="new-task">${icon.plus(15)}Nueva tarea</button>
    </div>
    ${ongoingGroup}
    ${groups}`;
}

const REQUEST_STATE: Record<WorkRequest['status'], string> = {
  waiting: 'Esperando',
  working: 'Preparando las tareas',
  done: 'Hecho',
  failed: 'No se pudo',
};

/** Your recent requests to the organiser and what came of them. */
function requests(): string {
  const s = getState();
  const recent = s.requests.filter((r) => r.status !== 'done' || Date.now() - (r.doneAt ?? 0) < 6 * 3600_000).slice(0, 5);
  if (!recent.length) return '';
  const organizer = s.workers.find((w) => w.role === 'organizer');
  return `
    <section class="section">
      <h2 class="section-title">Encargos</h2>
      <ul class="requests">${recent
        .map(
          (r) => `
          <li class="request request-${r.status}" data-key="req-${r.id}">
            <p class="request-text">«${esc(r.text)}»</p>
            <p class="meta">${r.status === 'working' ? '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span> ' : ''}${REQUEST_STATE[r.status]}${
              r.status === 'working' && r.tool ? ` · ${esc(organizer?.name ?? '')} está ${esc(r.tool)}` : ''
            }${r.status === 'waiting' && !(s.working && organizer?.enabled) ? ` · ${esc(organizer?.name ?? 'Organización')} lo verá al llegar` : ''} · <span class="num">${stamp(r.at)}</span></p>
            ${r.tools.length ? `<ul class="chat-tools">${r.tools.map((t) => `<li>${linkDossier(esc(t.note))}</li>`).join('')}</ul>` : ''}
            ${r.reply ? `<p class="request-reply"><strong>${esc(organizer?.name ?? 'Organización')}:</strong> ${linkDossier(esc(r.reply))}</p>` : ''}
          </li>`,
        )
        .join('')}</ul>
    </section>`;
}

export function bindTasks(el: HTMLElement, rerender: () => void): void {
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const f = target.closest<HTMLElement>('[data-filter]');
    if (f) {
      filter = f.dataset.filter as RoleId | 'all';
      return rerender();
    }
    if (target.closest('[data-new]')) return openTaskDialog(null, filter === 'all' ? undefined : filter);
    const t = target.closest<HTMLElement>('[data-task]');
    if (t) openTaskDialog(t.dataset.task!);
  });
  el.addEventListener(
    'toggle',
    (e) => {
      if ((e.target as HTMLElement).matches('details.group')) doneOpen = (e.target as HTMLDetailsElement).open;
    },
    true,
  );
}
