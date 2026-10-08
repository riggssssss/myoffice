import { ROLES, ROLE_ORDER } from '../sim/seed';
import { createTask, getState, requestWork, setStatus, task, updateTask } from '../sim/store';
import type { RoleId, TaskStatus } from '../sim/types';
import { esc } from './dom';
import { linkDossier } from './dossier';
import { icon } from './icons';

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Pendiente',
  doing: 'En curso',
  blocked: 'Bloqueada',
  review: 'En revisión',
  done: 'Hecha',
};

const dialog = () => document.getElementById('task-dialog') as HTMLDialogElement;

/**
 * With the AI working you just say what you want and the organiser makes the tasks; otherwise
 * (or by choice) you fill the task in yourself. Existing tasks are always edited by hand.
 */
export function openTaskDialog(taskId: string | null, role?: RoleId, manual = false): void {
  if (!taskId && !manual && getState().ai.state !== 'off') return openRequestDialog(role);
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
  // An ongoing job isn't reviewed and doesn't finish: it runs or it's stopped.
  const statuses = (Object.keys(STATUS_LABEL) as TaskStatus[])
    .filter((st) => !t?.ongoing || st !== 'review')
    .map((st) => `<option value="${st}" ${st === t?.status ? 'selected' : ''}>${t?.ongoing && st === 'done' ? 'Parada' : STATUS_LABEL[st]}</option>`)
    .join('');
  const ongoing = !!t?.ongoing;

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
        <div class="field" data-estimate ${ongoing ? 'hidden' : ''}>
          <label for="f-estimate">Estimación (horas)</label>
          <input id="f-estimate" name="estimate" type="number" min="1" max="40" step="1" inputmode="numeric" value="${t?.estimate ?? 4}" />
        </div>
      </div>
      <label class="check">
        <input type="checkbox" name="ongoing" ${ongoing ? 'checked' : ''} />
        <span>Continua: no tiene final, sigue hasta que la pares (llevar las redes, vigilar a la competencia…)</span>
      </label>
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
      <p class="section-note" data-queue-note>${
        ongoing
          ? 'Una tarea continua va a la par de lo que tenga la persona: no ocupa su cola.'
          : 'Si la asignas a alguien ocupado, queda en su cola y la empieza al terminar lo que tiene.'
      }</p>
      ${
        t?.notes.length
          ? `<section class="task-notes">
               <h3 class="section-title">Avances <span class="count">${t.notes.length}</span></h3>
               <ol>${[...t.notes]
                 .reverse()
                 .map(
                   (n) => `<li>
                     <p class="meta">${esc(s.workers.find((w) => w.id === n.by)?.name ?? '')} · <span class="num">${new Date(n.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>${n.tools.length ? ` · ${n.tools.map((x) => esc(x.note)).join(', ')}` : ''}</p>
                     <p>${linkDossier(esc(n.text))}</p>
                   </li>`,
                 )
                 .join('')}</ol>
             </section>`
          : ''
      }
      <footer class="dialog-foot">
        ${
          t?.ongoing && t.assigneeId
            ? t.status === 'done'
              ? `<button class="btn" type="button" data-resume>${icon.ongoing(15)}Reanudar</button>`
              : `<button class="btn" type="button" data-stop>${icon.stop(15)}Parar</button>`
            : ''
        }
        <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">${t ? 'Guardar cambios' : 'Crear tarea'}</button>
      </footer>
    </form>`;

  const form = d.querySelector('form')!;
  const title = form.querySelector<HTMLInputElement>('#f-title')!;
  const error = form.querySelector<HTMLElement>('#f-title-error')!;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  const ongoingBox = form.querySelector<HTMLInputElement>('[name="ongoing"]')!;
  ongoingBox.addEventListener('change', () => {
    form.querySelector<HTMLElement>('[data-estimate]')!.hidden = ongoingBox.checked;
    form.querySelector<HTMLElement>('[data-queue-note]')!.textContent = ongoingBox.checked
      ? 'Una tarea continua va a la par de lo que tenga la persona: no ocupa su cola.'
      : 'Si la asignas a alguien ocupado, queda en su cola y la empieza al terminar lo que tiene.';
  });
  form.querySelector('[data-stop]')?.addEventListener('click', () => {
    setStatus(t!.id, 'done');
    d.close();
  });
  form.querySelector('[data-resume]')?.addEventListener('click', () => {
    setStatus(t!.id, 'doing');
    d.close();
  });
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
    const ongoing = data.get('ongoing') === 'on';
    if (t) {
      updateTask(t.id, {
        title: name,
        role: roleValue,
        estimate,
        assigneeId,
        ongoing,
        status: (data.get('status') as TaskStatus) ?? t.status,
      });
    } else {
      createTask({ title: name, role: roleValue, estimate, assigneeId, ongoing });
    }
    d.close();
  });

  if (!d.open) d.showModal();
  if (!t) title.focus();
}

function openRequestDialog(role?: RoleId): void {
  const s = getState();
  const organizer = s.workers.find((w) => w.role === 'organizer');
  const name = organizer?.name ?? 'Organización';
  const away = !s.working || !organizer?.enabled;
  const d = dialog();
  d.innerHTML = `
    <form method="dialog" class="dialog-form" novalidate>
      <header class="dialog-head">
        <h2>Nuevo encargo</h2>
        <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
      </header>
      <div class="field">
        <label for="r-text">¿Qué quieres que se haga?</label>
        <textarea id="r-text" name="text" rows="5" maxlength="2000" placeholder="Ej. Quiero renovar la página de inicio: que se entienda en cinco segundos qué vendemos y que tenga una llamada a la acción clara." required></textarea>
        <p class="field-error" id="r-error" hidden>Cuéntalo en unas palabras.</p>
        <p class="section-note">${esc(name)} lo convertirá en tareas con su rol y estimación, y las repartirá a quien mejor encaje. Si alguien está ocupado, le queda en cola; si es algo que no acaba (llevar las redes, vigilar a la competencia), la deja como tarea continua. Luego puedes corregir cualquier tarea a mano.${
          away ? ` Ahora mismo ${esc(name)} no está en la oficina: lo hará en cuanto llegue.` : ''
        }</p>
      </div>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" type="button" data-manual>Crearla a mano</button>
        <button class="btn btn-primary" type="submit">Encargar a ${esc(name)}</button>
      </footer>
    </form>`;
  const form = d.querySelector('form')!;
  const text = form.querySelector<HTMLTextAreaElement>('#r-text')!;
  const error = form.querySelector<HTMLElement>('#r-error')!;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  d.querySelector('[data-manual]')!.addEventListener('click', () => openTaskDialog(null, role, true));
  text.addEventListener('input', () => (error.hidden = true));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (value.length < 3) {
      error.hidden = false;
      text.focus();
      return;
    }
    requestWork(value);
    d.close();
  });
  if (!d.open) d.showModal();
  text.focus();
}
