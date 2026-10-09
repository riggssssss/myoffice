import { bossProblem, depthOf, headOf, hireBasis, isRequired, MAX_DEPTH, PROFILE_MAX, type WorkerInput } from '../sim/ops';
import { REQUIRED_ROLES, ROLE_ORDER, ROLES } from '../sim/seed';
import { addWorker, api, askHireIdeas, closeMessage, getState, setProfile, subscribe, updateWorker, worker } from '../sim/store';
import type { AgentDraft, AgentProfile, HireIdea, RoleId } from '../sim/types';
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
 * Hire someone (`null`) or edit who they are. Hiring starts by telling what they'll do: the head
 * organises it into their card, and you edit it before they join (or fill it in by hand).
 * `suggested`: a hire an agent proposed, filled in; `onHired` runs once they're in.
 */
export function openWorkerDialog(id: string | null, suggested?: { role: RoleId; title: string; name: string }, onHired?: () => void): void {
  const workers = getState().workers;
  const w = worker(id);
  const head = headOf(workers);
  const fixed = !!w && isRequired(w);
  // Dirección, Organización and the sceptic come with the office, one each.
  const roles = fixed ? [w.role] : ROLE_ORDER.filter((r) => !REQUIRED_ROLES.includes(r));
  const d = document.getElementById('task-dialog') as HTMLDialogElement;

  /** What's in the form, kept across steps (each step is drawn anew). */
  const v = {
    describe: suggested ? `${suggested.title}` : '',
    name: w?.name ?? suggested?.name ?? '',
    role: (w?.role ?? (suggested && roles.includes(suggested.role) ? suggested.role : 'research')) as RoleId,
    title: w?.title ?? suggested?.title ?? '',
    boss: head?.id ?? '',
    summary: w?.profile?.summary ?? '',
    persona: w?.profile?.persona ?? '',
    focus: (w?.profile?.focus ?? []).join('\n'),
  };
  let step: 'describe' | 'form' = w ? 'form' : 'describe';
  let organising = false;
  let problem = '';
  /** The form came from the AI (it says so, and invites changes). */
  let drafted = false;
  let fromMsg: string | null = null;

  const bossOptions = () =>
    workers
      .filter((b) => !b.staff && depthOf(workers, b.id) + 1 <= MAX_DEPTH && (!w || !bossProblem(workers, w.id, b.id)))
      .map((b) => `<option value="${b.id}" ${b.id === v.boss ? 'selected' : ''}>${esc(b.name)} · ${esc(b.title)}</option>`)
      .join('');

  const describeStep = () => `
    <div class="field">
      <label for="a-describe">Explica qué hará</label>
      <textarea id="a-describe" data-v="describe" rows="5" maxlength="2000" placeholder="Ej. Alguien que lleve el email marketing: secuencias de bienvenida, newsletter quincenal y medir qué abre la gente. Que responda a quien lleve crecimiento." ${organising ? 'disabled' : ''}>${esc(v.describe)}</textarea>
      <p class="section-note">${esc(head?.name ?? 'Dirección')} lo organiza en su ficha: puesto, a quién responde, qué hará, cómo es y en qué se centra. Después la revisas y cambias lo que quieras.</p>
      ${problem ? `<p class="field-error" role="alert">${esc(problem)}</p>` : ''}
    </div>
    ${organising ? `<p class="ideas-note" aria-live="polite"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(head?.name ?? 'Dirección')} está organizando su ficha…</p>` : ''}
    <section class="ideas" id="a-ideas" aria-live="polite" aria-label="Sugeridos para tu proyecto"></section>
    <footer class="dialog-foot">
      <button class="btn btn-ghost" type="button" data-manual ${organising ? 'disabled' : ''}>Rellenar a mano</button>
      <button class="btn btn-primary" type="submit" ${organising ? 'disabled' : ''}>${icon.idea(15)}${organising ? 'Organizando…' : 'Organizar ficha'}</button>
    </footer>`;

  const formStep = () => `
    ${drafted ? `<p class="draft-note">${icon.idea(14)}Ficha organizada a partir de lo que contaste: revísala y cambia lo que quieras.</p>` : ''}
    <div class="field-row">
      <div class="field">
        <label for="a-name">Nombre</label>
        <input id="a-name" data-v="name" required maxlength="40" value="${esc(v.name)}" placeholder="Ej. Lucía" autocomplete="off" />
        <p class="field-error" id="a-name-error" hidden>Ponle un nombre.</p>
      </div>
      <div class="field">
        <label for="a-role">Rol</label>
        <select id="a-role" data-v="role" ${fixed ? 'disabled' : ''}>${roles.map((r) => `<option value="${r}" ${r === v.role ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}</select>
      </div>
    </div>
    <p class="section-note" id="a-role-about">${ROLES[v.role].about}${fixed ? ' Es un puesto fijo de la oficina.' : ''}</p>
    <div class="field">
      <label for="a-title">Puesto</label>
      <input id="a-title" data-v="title" maxlength="60" value="${esc(v.title)}" placeholder="${esc(ROLES[v.role].title)}" autocomplete="off" />
    </div>
    ${
      w
        ? ''
        : `<div class="field">
            <label for="a-boss">Responde a</label>
            <select id="a-boss" data-v="boss">${bossOptions()}</select>
          </div>`
    }
    <div class="field">
      <label for="a-summary">Qué hará</label>
      <textarea id="a-summary" data-v="summary" rows="2" maxlength="${PROFILE_MAX.summary}" placeholder="Una o dos frases: qué hace aquí y para qué">${esc(v.summary)}</textarea>
    </div>
    <div class="field">
      <label for="a-persona">Cómo es</label>
      <textarea id="a-persona" data-v="persona" rows="4" maxlength="${PROFILE_MAX.persona}" placeholder="Trayectoria, carácter, cómo habla y qué no tolera">${esc(v.persona)}</textarea>
    </div>
    <div class="field">
      <label for="a-focus">En qué se centra <span class="meta">una por línea</span></label>
      <textarea id="a-focus" data-v="focus" rows="4" placeholder="Prácticas concretas con las que trabaja">${esc(v.focus)}</textarea>
      <p class="section-note">${w ? 'Lo usa en todo lo que hace: en su mesa, en reuniones y en tu chat.' : 'Con «Qué hará» escrito entra directo a su mesa, sin entrevista. Sin él, lo entrevistan al llegar.'}</p>
    </div>
    <footer class="dialog-foot">
      ${w ? '<button class="btn btn-ghost" type="button" data-close>Cancelar</button>' : `<button class="btn btn-ghost" type="button" data-back>${icon.chevron(14)}Volver</button>`}
      <button class="btn btn-primary" type="submit">${w ? 'Guardar' : 'Añadir'}</button>
    </footer>`;

  let stop = () => {};
  const render = () => {
    stop();
    stop = () => {};
    d.innerHTML = `
      <form method="dialog" class="dialog-form worker-form" novalidate>
        <header class="dialog-head">
          <h2>${w ? `Editar a ${esc(w.name)}` : 'Añadir agente'}</h2>
          <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
        </header>
        ${step === 'describe' ? describeStep() : formStep()}
      </form>`;
    if (step === 'describe') watchIdeas();
  };

  // Suggestions: picking one writes it as the description, ready to organise.
  let list: Pick[] = [];
  const watchIdeas = () => {
    const el = d.querySelector<HTMLElement>('#a-ideas');
    if (!el) return;
    // Seen here: Dirección's message about them asks for nothing more.
    for (const m of getState().inbox) if (!m.closed && m.action?.type === 'ideas') closeMessage(m.id);
    let shown = '';
    const draw = () => {
      list = picks();
      const chosen = list.findIndex((p) => v.describe.startsWith(`${p.title}:`));
      const html = ideasHtml(list, chosen);
      if (html !== shown) el.innerHTML = shown = html;
    };
    stop = subscribe(draw);
    const h = getState().hireIdeas;
    if (h.status === 'idle' || (h.status === 'ready' && h.basis !== hireBasis(getState())) || h.status === 'failed') askHireIdeas();
    draw();
  };

  const organise = async () => {
    const text = v.describe.trim();
    if (text.length < 10) {
      problem = 'Cuéntalo un poco más: qué hará y para qué.';
      render();
      d.querySelector<HTMLElement>('#a-describe')?.focus();
      return;
    }
    organising = true;
    problem = '';
    render();
    try {
      const draft = await api<AgentDraft>('/api/agents/draft', 'POST', { text });
      Object.assign(v, {
        name: draft.name || v.name,
        role: roles.includes(draft.role) ? draft.role : v.role,
        title: draft.title,
        boss: draft.reportsTo ?? v.boss,
        summary: draft.profile.summary,
        persona: draft.profile.persona,
        focus: draft.profile.focus.join('\n'),
      });
      drafted = true;
      step = 'form';
    } catch (e) {
      problem = e instanceof Error ? e.message : 'No se pudo organizar ahora.';
    }
    organising = false;
    render();
    d.querySelector<HTMLElement>(step === 'form' ? (v.name ? '#a-summary' : '#a-name') : '#a-describe')?.focus();
  };

  d.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    const key = t.dataset.v as keyof typeof v | undefined;
    if (!key) return;
    (v as Record<string, string>)[key] = t.value;
    if (key === 'name') {
      d.querySelector('#a-name-error')?.setAttribute('hidden', '');
      t.removeAttribute('aria-invalid');
    }
  };
  d.onchange = (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.v !== 'role') return;
    v.role = t.value as RoleId;
    d.querySelector('#a-role-about')!.textContent = ROLES[v.role].about;
    d.querySelector<HTMLInputElement>('#a-title')!.placeholder = ROLES[v.role].title;
  };
  d.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) return d.close();
    if (t.closest('[data-manual]')) {
      step = 'form';
      drafted = false;
      render();
      return d.querySelector<HTMLElement>('#a-name')?.focus();
    }
    if (t.closest('[data-back]')) {
      step = 'describe';
      render();
      return d.querySelector<HTMLElement>('#a-describe')?.focus();
    }
    if (t.closest('[data-ideas-again]')) return askHireIdeas(true);
    const b = t.closest<HTMLElement>('[data-idea]');
    const p = b && list[Number(b.dataset.idea)];
    if (!p || organising) return;
    fromMsg = p.msg ?? null;
    v.describe = `${p.title}: ${p.why}`;
    v.role = p.role;
    if (p.name) v.name = p.name;
    problem = '';
    render();
    d.querySelector<HTMLTextAreaElement>('#a-describe')?.focus();
  };
  d.onsubmit = (e) => {
    e.preventDefault();
    if (step === 'describe') return void organise();
    const name = v.name.trim();
    if (!name) {
      const input = d.querySelector<HTMLInputElement>('#a-name')!;
      d.querySelector('#a-name-error')?.removeAttribute('hidden');
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', 'a-name-error');
      input.focus();
      return;
    }
    const summary = v.summary.trim();
    const profile: AgentProfile | null = summary
      ? { summary, persona: v.persona.trim(), focus: v.focus.split('\n').map((f) => f.trim().slice(0, PROFILE_MAX.focusItem)).filter(Boolean).slice(0, PROFILE_MAX.focus) }
      : null;
    const input: WorkerInput = { name, role: (w?.role ?? v.role) as RoleId, title: v.title.trim(), reportsTo: w ? null : v.boss || null, ...(profile ? { profile } : {}) };
    if (w) {
      updateWorker(w.id, input);
      setProfile(w.id, profile);
    } else {
      addWorker(input);
      onHired?.();
      if (fromMsg) closeMessage(fromMsg);
    }
    d.close();
  };
  // The dialog is shared with other forms: these handlers leave with this one.
  d.addEventListener(
    'close',
    () => {
      stop();
      d.oninput = d.onchange = d.onclick = d.onsubmit = null;
    },
    { once: true },
  );

  render();
  d.showModal();
  d.querySelector<HTMLElement>(step === 'describe' ? '#a-describe' : '#a-name')?.focus();
}
