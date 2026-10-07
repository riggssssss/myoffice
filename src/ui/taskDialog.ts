import { ROLES, ROLE_ORDER } from '../sim/seed';
import { createTask, getState, task, updateTask } from '../sim/store';
import type { RoleId, TaskStatus } from '../sim/types';
import { esc } from './dom';
import { icon } from './icons';

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Pendiente',
  doing: 'En curso',
  blocked: 'Bloqueada',
  review: 'En revisión',
  done: 'Hecha',
};

const dialog = () => document.getElementById('task-dialog') as HTMLDialogElement;

export function openTaskDialog(taskId: string | null, role?: RoleId): void {
  const s = getState();
  const t = task(taskId);
  const d = dialog();
  const currentRole = t?.role ?? role ?? 'design';

  const roleOptions = ROLE_ORDER.map(
    (r) => `<option value="${r}" ${r === currentRole ? 'selected' : ''}>${ROLES[r].label}</option>`,
  ).join('');
  const people = s.workers
    .map((w) => `<option value="${w.id}" ${w.id === t?.assigneeId ? 'selected' : ''}>${esc(w.name)} · ${esc(w.title)}</option>`)
    .join('');
  const statuses = (Object.keys(STATUS_LABEL) as TaskStatus[])
    .map((st) => `<option value="${st}" ${st === t?.status ? 'selected' : ''}>${STATUS_LABEL[st]}</option>`)
    .join('');

  d.innerHTML = `
    <form method="dialog" class="dialog-form" novalidate>
      <header class="dialog-head">
        <h2>${t ? 'Editar tarea' : 'Nueva tarea'}</h2>
        <button class="btn btn-icon" type="button" value="cancel" data-close aria-label="Cerrar">${icon.close(16)}</button>
      </header>
      <div class="field">
        <label for="f-title">Título</label>
        <input id="f-title" name="title" required maxlength="90" value="${esc(t?.title ?? '')}" placeholder="Ej. Diseño UI: pantalla de perfil" autocomplete="off" />
        <p class="field-error" id="f-title-error" hidden>Ponle un título para que el equipo sepa qué hacer.</p>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-role">Rol</label>
          <select id="f-role" name="role">${roleOptions}</select>
        </div>
        <div class="field">
          <label for="f-estimate">Estimación (horas)</label>
          <input id="f-estimate" name="estimate" type="number" min="1" max="40" step="1" inputmode="numeric" value="${t?.estimate ?? 4}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="f-assignee">Asignada a</label>
          <select id="f-assignee" name="assignee">
            <option value="">Sin asignar</option>
            ${people}
          </select>
        </div>
        ${
          t
            ? `<div class="field">
                <label for="f-status">Estado</label>
                <select id="f-status" name="status">${statuses}</select>
              </div>`
            : ''
        }
      </div>
      <p class="section-note">Si la asignas a alguien ocupado, su tarea actual vuelve a pendientes.</p>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">${t ? 'Guardar cambios' : 'Crear tarea'}</button>
      </footer>
    </form>`;

  const form = d.querySelector('form')!;
  const title = form.querySelector<HTMLInputElement>('#f-title')!;
  const error = form.querySelector<HTMLElement>('#f-title-error')!;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  title.addEventListener('input', () => {
    error.hidden = true;
    title.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('title') ?? '').trim();
    if (!name) {
      error.hidden = false;
      title.setAttribute('aria-invalid', 'true');
      title.setAttribute('aria-describedby', 'f-title-error');
      title.focus();
      return;
    }
    const estimate = Math.min(40, Math.max(1, Math.round(Number(data.get('estimate')) || 4)));
    const roleValue = data.get('role') as RoleId;
    const assigneeId = (data.get('assignee') as string) || null;
    if (t) {
      updateTask(t.id, {
        title: name,
        role: roleValue,
        estimate,
        assigneeId,
        status: (data.get('status') as TaskStatus) ?? t.status,
      });
    } else {
      createTask({ title: name, role: roleValue, estimate, assigneeId });
    }
    d.close();
  });

  d.showModal();
  if (!t) title.focus();
}
