import { bossProblem, depthOf, headOf, hireBasis, isRequired, MAX_DEPTH, type WorkerInput } from '../sim/ops';
import { REQUIRED_ROLES, ROLE_ORDER, ROLES } from '../sim/seed';
import { addWorker, askHireIdeas, closeMessage, getState, subscribe, updateWorker, worker } from '../sim/store';
import type { HireIdea, RoleId } from '../sim/types';
import { esc } from './dom';
import { icon } from './icons';

/** A suggestion to pick from: an agent's proposal in your inbox, or the head's list. */
interface Pick extends HireIdea {
  /** The inbox message it came from, closed once they're hired. */
  msg?: string;
  from?: string;
}

function picks(): Pick[] {
  const st = getState();
  const proposed: Pick[] = st.inbox
    .filter((m) => !m.closed && m.action?.type === 'hire')
    .map((m) => {
      const a = m.action as Extract<typeof m.action, { type: 'hire' }>;
      return { role: a.role, title: a.title, name: a.name, why: m.text, msg: m.id, from: worker(m.from)?.name };
    });
  const seen = new Set(proposed.map((p) => `${p.role}:${p.title.toLowerCase()}`));
  return [...proposed, ...st.hireIdeas.items.filter((i) => !seen.has(`${i.role}:${i.title.toLowerCase()}`))];
}

/** «Sugeridos para tu proyecto»: what the head thinks you need, live while the dialog is open. */
function ideasHtml(list: Pick[], chosen: number): string {
  const st = getState();
  const h = st.hireIdeas;
  const head = worker(h.by) ?? headOf(st.workers);
  const thinking = h.status === 'asked' || h.status === 'thinking';
  const stale = h.status === 'ready' && h.basis !== hireBasis(getState());
  const cards = list
    .map(
      (p, i) => `
      <button class="idea${i === chosen ? ' is-chosen' : ''}" type="button" data-idea="${i}" aria-pressed="${i === chosen}" style="--role:${ROLES[p.role].color}">
        <span class="idea-head">
          <span class="dot" aria-hidden="true"></span>
          <strong>${esc(p.title)}</strong>
          <span class="meta">${ROLES[p.role].label}${p.from ? ` · lo propone ${esc(p.from)}` : ''}</span>
        </span>
        <span class="idea-why">${esc(p.why)}</span>
      </button>`,
    )
    .join('');
  const status = thinking
    ? `<p class="ideas-note"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(head?.name ?? 'Dirección')} está pensando a quién necesita tu proyecto…</p>`
    : h.status === 'failed'
      ? `<p class="ideas-note is-error">${esc(h.note)}</p>`
      : stale
        ? `<p class="ideas-note">Tu proyecto ha cambiado desde esta lista.</p>`
        : h.note
          ? `<p class="ideas-note">${esc(h.note)}</p>`
          : '';
  return `
    <div class="ideas-head">
      <h3>${icon.idea(15)}Sugeridos para tu proyecto</h3>
      <button class="btn btn-ghost btn-sm" type="button" data-ideas-again ${thinking ? 'disabled' : ''}>${icon.refresh(13)}${h.status === 'idle' ? 'Pedir' : 'Pedir otras'}</button>
    </div>
    ${status}
    ${cards ? `<div class="ideas-list">${cards}</div>` : ''}`;
}

/**
 * Hire someone (`null`) or edit who they are. Who they answer to is changed in the org chart.
 * `suggested`: a hire an agent proposed, filled in; `onHired` runs once they're in.
 */
export function openWorkerDialog(id: string | null, suggested?: { role: RoleId; title: string; name: string }, onHired?: () => void): void {
  const workers = getState().workers;
  const w = worker(id);
  const head = headOf(workers);
  const fixed = !!w && isRequired(w);
  // Dirección, Organización and the sceptic come with the office, one each.
  const roles = fixed ? [w.role] : ROLE_ORDER.filter((r) => !REQUIRED_ROLES.includes(r));
  const role: RoleId = w?.role ?? (suggested && roles.includes(suggested.role) ? suggested.role : 'research');
  const d = document.getElementById('task-dialog') as HTMLDialogElement;

  const roleOptions = roles.map((r) => `<option value="${r}" ${r === role ? 'selected' : ''}>${ROLES[r].label}</option>`).join('');
  // New people can go under anyone with room for one more level below them.
  const bosses = workers
    .filter((b) => !b.staff && depthOf(workers, b.id) + 1 <= MAX_DEPTH && (!w || !bossProblem(workers, w.id, b.id)))
    .map((b) => `<option value="${b.id}" ${b.id === head?.id ? 'selected' : ''}>${esc(b.name)} · ${esc(b.title)}</option>`)
    .join('');

  d.innerHTML = `
    <form method="dialog" class="dialog-form" novalidate>
      <header class="dialog-head">
        <h2>${w ? `Editar a ${esc(w.name)}` : 'Añadir agente'}</h2>
        <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
      </header>
      ${w ? '' : '<section class="ideas" id="a-ideas" aria-live="polite" aria-label="Sugeridos para tu proyecto"></section>'}
      <div class="field">
        <label for="a-name">Nombre</label>
        <input id="a-name" name="name" required maxlength="40" value="${esc(w?.name ?? suggested?.name ?? '')}" placeholder="Ej. Lucía" autocomplete="off" />
        <p class="field-error" id="a-name-error" hidden>Ponle un nombre.</p>
      </div>
      <div class="field">
        <label for="a-role">Rol</label>
        <select id="a-role" name="role" ${fixed ? 'disabled' : ''}>${roleOptions}</select>
        <p class="section-note" id="a-role-about">${ROLES[role].about}${fixed ? ' Es un puesto fijo de la oficina.' : ''}</p>
      </div>
      <div class="field">
        <label for="a-title">Puesto</label>
        <input id="a-title" name="title" maxlength="60" value="${esc(w?.title ?? suggested?.title ?? '')}" placeholder="${esc(ROLES[role].title)}" autocomplete="off" />
      </div>
      ${
        w
          ? ''
          : `<div class="field">
              <label for="a-boss">Responde a</label>
              <select id="a-boss" name="boss">${bosses}</select>
              <p class="section-note">Entrará por la puerta y se sentará en su puesto nuevo.</p>
            </div>`
      }
      <footer class="dialog-foot">
        <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">${w ? 'Guardar' : 'Añadir'}</button>
      </footer>
    </form>`;

  const form = d.querySelector('form')!;
  const name = form.querySelector<HTMLInputElement>('#a-name')!;
  const error = form.querySelector<HTMLElement>('#a-name-error')!;
  const roleSel = form.querySelector<HTMLSelectElement>('#a-role')!;
  const title = form.querySelector<HTMLInputElement>('#a-title')!;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  name.addEventListener('input', () => {
    error.hidden = true;
    name.removeAttribute('aria-invalid');
  });
  const showRole = () => {
    const r = roleSel.value as RoleId;
    form.querySelector('#a-role-about')!.textContent = ROLES[r].about;
    title.placeholder = ROLES[r].title;
  };
  roleSel.addEventListener('change', showRole);

  // Suggestions: picking one fills the form in; the list keeps up while the head thinks.
  const ideasEl = form.querySelector<HTMLElement>('#a-ideas');
  let list: Pick[] = [];
  let chosen = suggested ? -1 : -2;
  let fromMsg: string | null = null;
  let stop = () => {};
  if (ideasEl) {
    // Seen here: Dirección's message about them asks for nothing more.
    for (const m of getState().inbox) if (!m.closed && m.action?.type === 'ideas') closeMessage(m.id);
    let shown = '';
    const draw = () => {
      list = picks();
      if (chosen === -1 && suggested) chosen = list.findIndex((p) => p.role === suggested.role && p.title === suggested.title);
      const html = ideasHtml(list, chosen);
      if (html !== shown) ideasEl.innerHTML = shown = html;
    };
    stop = subscribe(draw);
    const h = getState().hireIdeas;
    if (h.status === 'idle' || (h.status === 'ready' && h.basis !== hireBasis(getState())) || h.status === 'failed') askHireIdeas();
    draw();
    ideasEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-ideas-again]')) return askHireIdeas(true);
      const b = t.closest<HTMLElement>('[data-idea]');
      const p = b && list[Number(b.dataset.idea)];
      if (!p) return;
      chosen = Number(b.dataset.idea);
      fromMsg = p.msg ?? null;
      roleSel.value = p.role;
      showRole();
      title.value = p.title;
      if (p.name && (!name.value.trim() || list.some((x) => x.name === name.value.trim()))) name.value = p.name;
      error.hidden = true;
      draw();
      name.focus();
    });
  }
  d.addEventListener('close', () => stop(), { once: true });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const value = String(data.get('name') ?? '').trim();
    if (!value) {
      error.hidden = false;
      name.setAttribute('aria-invalid', 'true');
      name.setAttribute('aria-describedby', 'a-name-error');
      name.focus();
      return;
    }
    const input: WorkerInput = {
      name: value,
      role: (w?.role ?? roleSel.value) as RoleId,
      title: String(data.get('title') ?? '').trim(),
      reportsTo: (data.get('boss') as string | null) || null,
    };
    if (w) updateWorker(w.id, input);
    else {
      addWorker(input);
      onHired?.();
      if (fromMsg) closeMessage(fromMsg);
    }
    d.close();
  });

  d.showModal();
  name.focus();
}
