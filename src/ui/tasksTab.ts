import { ROLES, ROLE_ORDER } from '../sim/seed';
import { getState, worker } from '../sim/store';
import type { RoleId, Task, TaskStatus } from '../sim/types';
import { bar, esc, pct, roleDot } from './dom';
import { icon } from './icons';
import { openTaskDialog } from './taskDialog';

const GROUPS: { status: TaskStatus; title: string; empty: string }[] = [
  { status: 'blocked', title: 'Bloqueadas', empty: 'Nada bloqueado ahora mismo.' },
  { status: 'doing', title: 'En curso', empty: 'Nadie está trabajando en nada. ¿Es la hora de la daily?' },
  { status: 'review', title: 'En revisión', empty: 'Sin nada esperando a QA.' },
  { status: 'backlog', title: 'Pendientes', empty: 'Backlog vacío. Cuando alguien se quede sin trabajo, se inventará algo.' },
  { status: 'done', title: 'Hechas', empty: 'Aún no se ha terminado nada.' },
];

let filter: RoleId | 'all' = 'all';
let doneOpen = false;

function row(t: Task): string {
  const who = worker(t.assigneeId);
  const value = t.status === 'review' ? t.reviewProgress : t.progress;
  const assignee =
    t.status === 'review' ? 'Esperando QA' : who ? esc(who.name) : '<span class="muted">Sin asignar</span>';
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

  const groups = GROUPS.map((g) => {
    const list = tasks
      .filter((t) => t.status === g.status)
      .sort((a, b) =>
        g.status === 'done' ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : b.progress - a.progress || a.createdAt - b.createdAt,
      );
    const body = list.length ? `<ul class="tasks">${list.map(row).join('')}</ul>` : `<p class="section-note">${g.empty}</p>`;
    if (g.status === 'done') {
      return `<details class="section group" data-key="done-group" ${doneOpen ? 'open' : ''}>
        <summary class="section-title">${g.title} <span class="count">${list.length}</span></summary>${body}</details>`;
    }
    if (g.status === 'blocked' && !list.length) return '';
    return `<section class="section group group-${g.status}">
      <h2 class="section-title">${g.title} <span class="count">${list.length}</span></h2>${body}</section>`;
  }).join('');

  return `
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Filtrar por rol">${chips}</div>
      <button class="btn btn-primary" type="button" data-new data-key="new-task">${icon.plus(15)}Nueva tarea</button>
    </div>
    ${groups}`;
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
