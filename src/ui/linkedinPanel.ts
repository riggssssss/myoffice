/**
 * Ajustes → Conectores → LinkedIn, once it's connected: your voice (how you write; the team
 * writes like you), the weekly plan (days, time, who runs it, your themes), this week's posts and
 * how each went, and a box to try the humanizer on any text.
 */
import { POST_TYPES, VOICE_TEMPLATE, WEEK_DAYS, type LinkedInView, type PlanSettings, type PlanSlot } from '../sim/linkedin';
import { api, getState, worker } from '../sim/store';
import { esc } from './dom';
import { icon } from './icons';

interface Humanized {
  text: string;
  changes: { what: string; count: number; to?: string }[];
  flags: { name: string; fix: string }[];
  before: { score: number };
  after: { score: number; verdict: string; weakest: string; checks: { label: string; score: number; detail: string }[] };
}

let view: LinkedInView | null = null;
let loading = false;
let problem = '';
let note = '';
/** What you're typing, kept across redraws. */
const draft: { voice: string | null; posts: string; themes: string | null; test: string } = { voice: null, posts: '', themes: null, test: '' };
let fromPosts = false;
let writingVoice = false;
let tested: Humanized | null = null;
let testing = false;

const redraw = () => document.dispatchEvent(new Event('apps-change'));

export async function loadLinkedIn(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    view = await api<LinkedInView>('/api/linkedin');
    problem = '';
  } catch (e) {
    problem = e instanceof Error ? e.message : 'No responde';
  }
  loading = false;
  redraw();
}

// The plan moves on its own (a post written, approved…): the panel follows, unless you're typing in it.
document.addEventListener('linkedin-changed', () => {
  const typing = document.activeElement?.closest('[data-li]') && document.activeElement.matches('textarea, input');
  if (!typing) void loadLinkedIn();
});

const STATUS: Record<PlanSlot['status'], string> = {
  planeado: 'Planeado',
  escribiendo: 'Escribiéndolo…',
  esperando: 'Espera tu aprobación',
  publicado: 'Publicado',
  descartado: 'Descartado',
  fallo: 'No salió',
};

const when = (at: number) => {
  const d = new Date(at);
  return `${WEEK_DAYS.find((x) => x.n === d.getDay())!.name} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
};

function weekView(v: LinkedInView): string {
  const w = v.week;
  if (!v.plan.on) return '';
  if (!w || !w.slots.length) {
    return `<p class="section-note">${v.busy ? esc(v.busy) + '…' : 'El plan de esta semana se prepara en cuanto la oficina esté abierta.'}</p>`;
  }
  return `
    <div class="li-week">
      <div class="guide-head">
        <h4 class="li-sub">Esta semana</h4>
        <button class="btn btn-ghost btn-sm" type="button" data-li-redo ${v.busy ? 'disabled' : ''}>${icon.refresh(13)}Rehacer el plan</button>
      </div>
      ${v.busy ? `<p class="meta li-busy"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>${esc(v.busy)}</p>` : ''}
      <ul class="li-slots">
        ${w.slots
          .map(
            (s) => `
          <li class="li-slot is-${s.status}">
            <span class="li-when">${esc(when(s.at))}</span>
            <span class="li-what"><b>${POST_TYPES[s.type].label}</b> · gancho #${s.hook}<span class="li-angle">${esc(s.angle)}</span>${s.note ? `<span class="meta">${esc(s.note)}</span>` : ''}</span>
            <span class="li-status">${STATUS[s.status]}${s.score !== undefined ? ` · ${s.score}/100` : ''}</span>
          </li>`,
          )
          .join('')}
      </ul>
      ${w.engage.length ? `<details class="li-engage"><summary>Para interactuar esta semana (${w.engage.length})</summary><ul>${w.engage.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
}

function testView(): string {
  const h = tested;
  return `
    <details class="li-test" ${h || draft.test ? 'open' : ''}>
      <summary>Probar el humanizador con un texto</summary>
      <div class="field">
        <label class="sr-only" for="li-test">Texto para analizar</label>
        <textarea id="li-test" data-li="test" rows="5" placeholder="Pega un post o un borrador: le quito el tono de IA y le pongo nota">${esc(draft.test)}</textarea>
      </div>
      <button class="btn btn-sm" type="button" data-li-test ${testing ? 'disabled' : ''}>${testing ? 'Analizando…' : 'Analizar'}</button>
      ${
        h
          ? `<div class="li-result">
              <p class="post-score ${h.after.verdict === 'pasa' ? 'is-ok' : h.after.verdict === 'revisar' ? 'is-warn' : 'is-bad'}"><b>${h.after.score}</b>/100 humano · ${esc(h.after.verdict)} <span class="meta">(antes ${h.before.score})</span></p>
              <ul class="li-checks">${h.after.checks.map((c) => `<li><span>${esc(c.label)}</span><span class="bar"><i style="transform:scaleX(${c.score / 100})"></i></span><span class="num">${c.score}</span><span class="meta">${esc(c.detail)}</span></li>`).join('')}</ul>
              ${h.changes.length ? `<p class="meta">Limpiado: ${h.changes.map((c) => `${c.count}× ${esc(c.what)}${c.to ? ` → ${esc(c.to)}` : ''}`).join(' · ')}</p>` : ''}
              ${h.flags.length ? `<p class="li-flags-title">Por reescribir a mano</p><ul class="li-flags">${h.flags.map((f) => `<li><b>${esc(f.name)}</b> ${esc(f.fix)}</li>`).join('')}</ul>` : ''}
              <div class="post-text">${esc(h.text)}</div>
            </div>`
          : ''
      }
    </details>`;
}

/** The section, when LinkedIn is connected. */
export function linkedinPanel(): string {
  if (!view && !loading && !problem) void loadLinkedIn();
  if (!view?.connected) return '';
  const p = view.plan;
  const workers = getState().workers.filter((w) => w.enabled);
  const auto = worker(view.runner);
  const voiceText = draft.voice ?? view.voice;
  return `
    <section class="settings-section li-panel" data-li-panel>
      <h3 class="section-title">LinkedIn</h3>
      <p class="section-note">El equipo escribe y tú apruebas: cada post pasa por el humanizador (le quita el tono de IA y le pone nota) y te llega a «Para ti» tal como saldrá. Uno al día como mucho, para que nunca parezca automatizado.</p>
      ${problem ? `<p class="field-error">${esc(problem)}</p>` : ''}
      ${note ? `<p class="section-note" role="status">${esc(note)}</p>` : ''}

      <div class="field">
        <label for="li-voice">Tu voz <span class="meta">cómo escribes: la usan quienes publican por ti</span></label>
        <textarea id="li-voice" data-li="voice" rows="${voiceText ? 10 : 6}" placeholder="${esc(VOICE_TEMPLATE)}">${esc(voiceText)}</textarea>
        <div class="actions">
          <button class="btn btn-sm" type="button" data-li-voice-save ${draft.voice === null ? 'disabled' : ''}>Guardar mi voz</button>
          <button class="btn btn-ghost btn-sm" type="button" data-li-from-posts aria-expanded="${fromPosts}">Escribirla a partir de mis posts</button>
        </div>
        ${
          fromPosts
            ? `<div class="li-from-posts">
                <label for="li-posts">Pega dos o tres posts tuyos (los que más suenen a ti)</label>
                <textarea id="li-posts" data-li="posts" rows="6">${esc(draft.posts)}</textarea>
                <button class="btn btn-sm btn-primary" type="button" data-li-voice-draft ${writingVoice ? 'disabled' : ''}>${writingVoice ? 'Leyéndolos…' : 'Escribir mi voz'}</button>
              </div>`
            : ''
        }
      </div>

      <div class="li-plan">
        <button class="work" type="button" role="switch" aria-checked="${p.on}" data-li-on>
          <span class="work-track" aria-hidden="true"></span>
          <span class="work-label">Plan semanal</span>
        </button>
        <p class="section-note">${p.on ? `Cada semana ${esc(auto?.name ?? 'el equipo')} prepara el plan (qué tipo de post, qué gancho, qué ángulo) y escribe cada post el día que toca. Se hace con la oficina abierta.` : 'Actívalo y el equipo te propone los posts de la semana, cada uno el día que toca, listo para aprobar.'}</p>
        ${
          p.on
            ? `<div class="field-row">
                <div class="field">
                  <label for="li-per">Posts a la semana</label>
                  <select id="li-per" data-li-per>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === p.perWeek ? 'selected' : ''}>${n}${n === 4 ? ' (lo recomendado)' : ''}</option>`).join('')}</select>
                </div>
                <div class="field">
                  <label for="li-time">Hora</label>
                  <input id="li-time" data-li-time type="time" value="${p.time}" />
                </div>
              </div>
              <fieldset class="field li-days">
                <legend>Días</legend>
                <div class="li-day-row">${WEEK_DAYS.map((d) => `<label class="li-day"><input type="checkbox" data-li-day="${d.n}" ${p.days.includes(d.n) ? 'checked' : ''} /><span title="${d.name}">${d.short}</span></label>`).join('')}</div>
                <p class="section-note">Para un público profesional, de martes a jueves a primera hora. Aun así, la primera línea importa mucho más que la hora.</p>
              </fieldset>
              <div class="field">
                <label for="li-who">Quién lo lleva</label>
                <select id="li-who" data-li-who>
                  <option value="" ${p.who ? '' : 'selected'}>Automático${!p.who && auto ? ` (${esc(auto.name)})` : ''}</option>
                  ${workers.map((w) => `<option value="${w.id}" ${p.who === w.id ? 'selected' : ''}>${esc(w.name)} · ${esc(w.title)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="li-themes">Temas y lo que ha pasado esta semana</label>
                <textarea id="li-themes" data-li="themes" rows="4" placeholder="Por qué quieres que te conozcan (3-4 temas) y qué ha pasado de verdad: una llamada, una cifra, un error, algo que has construido. De ahí salen los buenos posts.">${esc(draft.themes ?? p.themes)}</textarea>
                <button class="btn btn-sm" type="button" data-li-themes-save ${draft.themes === null ? 'disabled' : ''}>Guardar temas</button>
              </div>
              ${weekView(view)}`
            : ''
        }
      </div>
      ${testView()}
    </section>`;
}

async function savePlan(patch: Partial<PlanSettings>): Promise<void> {
  try {
    view = await api<LinkedInView>('/api/linkedin/plan', 'PUT', patch);
    problem = '';
  } catch (e) {
    problem = e instanceof Error ? e.message : 'No se pudo guardar';
  }
}

export async function linkedinClick(t: HTMLElement, render: () => void): Promise<boolean> {
  if (!t.closest('[data-li-panel]')) return false;
  if (t.closest('[data-li-on]')) {
    await savePlan({ on: !view?.plan.on });
    render();
    return true;
  }
  if (t.closest('[data-li-voice-save]')) {
    try {
      view = await api<LinkedInView>('/api/linkedin/voice', 'PUT', { text: draft.voice ?? '' });
      draft.voice = null;
      note = 'Tu voz está guardada: la usan quienes escriben por ti.';
    } catch (e) {
      problem = e instanceof Error ? e.message : 'No se pudo guardar';
    }
    render();
    return true;
  }
  if (t.closest('[data-li-from-posts]')) {
    fromPosts = !fromPosts;
    render();
    return true;
  }
  if (t.closest('[data-li-voice-draft]')) {
    writingVoice = true;
    problem = '';
    render();
    try {
      const r = await api<{ text: string }>('/api/linkedin/voice/draft', 'POST', { posts: draft.posts });
      draft.voice = r.text;
      fromPosts = false;
      note = 'Esta es tu voz según tus posts: revísala y pulsa «Guardar mi voz».';
    } catch (e) {
      problem = e instanceof Error ? e.message : 'No se pudo';
    }
    writingVoice = false;
    render();
    return true;
  }
  if (t.closest('[data-li-themes-save]')) {
    await savePlan({ themes: draft.themes ?? '' });
    draft.themes = null;
    note = 'Temas guardados: el próximo plan sale de ahí.';
    render();
    return true;
  }
  if (t.closest('[data-li-redo]')) {
    try {
      view = await api<LinkedInView>('/api/linkedin/plan/redo', 'POST');
      note = 'Se rehace el plan en cuanto la oficina esté abierta (un minuto como mucho).';
    } catch (e) {
      problem = e instanceof Error ? e.message : 'No se pudo';
    }
    render();
    return true;
  }
  if (t.closest('[data-li-test]')) {
    testing = true;
    render();
    try {
      tested = await api<Humanized>('/api/linkedin/humanize', 'POST', { text: draft.test });
      problem = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : 'No se pudo analizar';
    }
    testing = false;
    render();
    return true;
  }
  return false;
}

export async function linkedinChange(t: HTMLElement, render: () => void): Promise<boolean> {
  if (!t.closest('[data-li-panel]')) return false;
  if (t.matches('[data-li-per]')) await savePlan({ perWeek: Number((t as HTMLSelectElement).value) });
  else if (t.matches('[data-li-time]')) await savePlan({ time: (t as HTMLInputElement).value });
  else if (t.matches('[data-li-who]')) await savePlan({ who: (t as HTMLSelectElement).value || null });
  else if (t.matches('[data-li-day]')) {
    const days = [...document.querySelectorAll<HTMLInputElement>('[data-li-day]')].filter((x) => x.checked).map((x) => Number(x.dataset.liDay));
    await savePlan({ days });
  } else return t.matches('[data-li]');
  render();
  return true;
}

export function linkedinInput(t: HTMLElement): boolean {
  const key = (t as HTMLElement).dataset.li as keyof typeof draft | undefined;
  if (!key) return false;
  draft[key] = (t as HTMLTextAreaElement).value;
  // The save buttons wake up as soon as you write.
  if (key === 'voice') document.querySelector<HTMLButtonElement>('[data-li-voice-save]')?.removeAttribute('disabled');
  if (key === 'themes') document.querySelector<HTMLButtonElement>('[data-li-themes-save]')?.removeAttribute('disabled');
  return true;
}
