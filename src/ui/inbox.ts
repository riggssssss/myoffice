import { ROLES } from '../sim/seed';
import { api, closeMessage, getState, readMessages, select, subscribe, worker } from '../sim/store';
import type { OwnerMessage } from '../sim/types';
import type { PostReview } from '../sim/linkedin';
import { openCalendar } from './calendar';
import { openChange } from './changeDialog';
import { esc, stamp } from './dom';
import { linkDossier } from './dossier';
import { icon } from './icons';
import { openWorkerDialog } from './workerDialog';

/**
 * Everything the agents say to you directly: reminders, questions, proposals to hire, replies
 * to what you asked. New ones pop up bottom left; all of them stay listed under «Para ti».
 */

const KIND: Record<OwnerMessage['kind'], string> = {
  reminder: 'Recordatorio',
  question: 'Pregunta',
  hire: 'Propuesta de contratación',
  reply: 'Respuesta',
  meeting: 'Reunión',
  ideas: 'Sugerencias para contratar',
  change: 'Cambio en tu proyecto',
  app: 'Acción en tus apps',
};

const MAX_TOASTS = 3;

function actions(m: OwnerMessage): string {
  const a = m.action;
  // Looking at the calendar or a change is always there; anything else only while it's still open.
  if (!a || (m.closed && a.type !== 'calendar' && a.type !== 'change')) return '';
  const btn = (act: string, label: string, primary = false) => `<button class="btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}" type="button" data-msg-act="${act}" data-msg="${m.id}">${label}</button>`;
  switch (a.type) {
    case 'hire':
      return `${btn('hire', `${icon.userPlus(14)}Contratar`, true)}${btn('later', 'Ahora no')}`;
    case 'answer':
      return btn('answer', 'Responder', true);
    case 'calendar':
      return btn('calendar', `${icon.calendar(14)}Ver calendario`);
    case 'meeting':
      return getState().meeting ? btn('meeting', 'Ir a la reunión', true) : '';
    case 'ideas':
      return btn('ideas', `${icon.idea(14)}Ver sugerencias`, true);
    case 'change':
      return btn('change', m.closed ? 'Ver cambio' : 'Revisar cambio', !m.closed);
    case 'app':
      return `${btn('app-approve', `${icon.check(14)}Aprobar`, true)}${btn('app-reject', 'Descartar')}`;
  }
}

/** A post for your LinkedIn: as it will go out, and how human it sounds after the humanizer. */
function postView(m: OwnerMessage, text: string, r: PostReview, toast: boolean): string {
  const tone = r.verdict === 'pasa' ? 'is-ok' : r.verdict === 'revisar' ? 'is-warn' : 'is-bad';
  const when = r.for ? `Pensado para el ${new Date(r.for).toLocaleDateString('es-ES', { weekday: 'long' })} a las ${new Date(r.for).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}: al aprobarlo se publica ya.` : 'Al aprobarlo se publica ya.';
  return `
    <div class="post-review">
      <p class="post-score ${tone}"><b>${r.score}</b>/100 humano · ${r.verdict === 'pasa' ? 'Pasa' : r.verdict === 'revisar' ? 'Revisar' : 'Suena a IA'}${r.verdict !== 'pasa' ? ` · lo más flojo: ${esc(r.weakest.toLowerCase())}` : ''}</p>
      ${
        toast
          ? ''
          : m.closed
            ? `<div class="post-text">${esc(text)}</div>`
            : `<label class="sr-only" for="post-${m.id}">Texto del post (puedes editarlo antes de aprobar)</label>
               <textarea class="post-text post-edit" id="post-${m.id}" data-post-edit="${m.id}" rows="${Math.min(16, Math.max(6, text.split('\n').length + 1))}">${esc(text)}</textarea>`
      }
      ${!toast && r.flags.length ? `<p class="meta">Queda por pulir: ${r.flags.map(esc).join(' · ')}</p>` : ''}
      ${toast ? '' : `<p class="meta">${when}</p>`}
    </div>`;
}

/** One message: who, what, and what you can do about it. */
export function messageCard(m: OwnerMessage, toast = false): string {
  const w = worker(m.from);
  const acts = actions(m);
  return `
    <article class="msg${m.read ? '' : ' is-unread'}${m.closed ? ' is-closed' : ''}${toast ? ' msg-toast' : ''}" data-key="msg-${m.id}${toast ? '-t' : ''}" aria-label="${esc(KIND[m.kind])} de ${esc(w?.name ?? 'la oficina')}">
      <header class="msg-head">
        <span class="talk-dot" style="--role:${w ? ROLES[w.role].color : '#999'}" aria-hidden="true">${esc((w?.name ?? '?').charAt(0))}</span>
        <span class="msg-who"><strong>${esc(w?.name ?? 'La oficina')}</strong> <span class="meta">${KIND[m.kind]} · <span class="num">${stamp(m.at)}</span></span></span>
        ${toast ? `<button class="btn btn-icon btn-sm" type="button" data-msg-act="dismiss" data-msg="${m.id}" aria-label="Cerrar aviso">${icon.close(14)}</button>` : ''}
      </header>
      <p class="msg-text">${linkDossier(esc(m.text))}</p>
      ${m.action?.type === 'app' && m.action.review ? postView(m, m.detail, m.action.review, toast) : m.detail && !toast ? `<p class="msg-detail">${linkDossier(esc(m.detail))}</p>` : ''}
      ${acts ? `<div class="msg-actions">${acts}</div>` : ''}
    </article>`;
}

export const unreadCount = () => getState().inbox.filter((m) => !m.read).length;

/** The «Para ti» tab: open ones first, then the rest, newest first. */
export function renderInbox(): string {
  const all = getState().inbox;
  if (!all.length) {
    return `<p class="section-note">Aquí te llegará lo que el equipo te diga a ti: recordatorios del calendario, preguntas, propuestas de contratar a alguien y respuestas a tus encargos.</p>`;
  }
  const open = all.filter((m) => !m.closed);
  const rest = all.filter((m) => m.closed);
  return `
    ${open.length ? `<section class="section"><h2 class="section-title">Esperan algo de ti <span class="count">${open.length}</span></h2><div class="msgs">${open.map((m) => messageCard(m)).join('')}</div></section>` : ''}
    ${rest.length ? `<section class="section"><h2 class="section-title">Mensajes</h2><div class="msgs">${rest.map((m) => messageCard(m)).join('')}</div></section>` : ''}`;
}

function act(id: string, what: string): void {
  const m = getState().inbox.find((x) => x.id === id);
  if (!m) return;
  readMessages([id]);
  const a = m.action;
  if (what === 'dismiss') return;
  if (what === 'later') return closeMessage(id);
  if (what === 'hire' && a?.type === 'hire') return openWorkerDialog(null, a, () => closeMessage(id));
  if (what === 'answer' && a?.type === 'answer') {
    const q = getState().questions.find((x) => x.id === a.questionId);
    if (q) select(q.workerId);
    return;
  }
  if (what === 'calendar' && a?.type === 'calendar') return openCalendar(a.eventId);
  if (what === 'ideas') return openWorkerDialog(null);
  if (what === 'change' && a?.type === 'change') return void openChange(a.changeId);
  if ((what === 'app-approve' || what === 'app-reject') && a?.type === 'app') return void decideApp(id, a.actionId, what === 'app-approve');
  if (what === 'meeting') closeMessage(id);
}

/** Your yes or no to an agent's action in one of your apps; it runs on the server, there and then. */
async function decideApp(msgId: string, actionId: string, yes: boolean): Promise<void> {
  const card = document.querySelectorAll<HTMLElement>(`[data-key^="msg-${msgId}"] .msg-actions`);
  // A post: what's in its box now is what goes out.
  const edited = document.querySelector<HTMLTextAreaElement>(`[data-post-edit="${msgId}"]`)?.value;
  if (yes && edited !== undefined && /\{\{[^}]*\}\}/.test(edited)) {
    card.forEach((el) => el.insertAdjacentHTML('afterbegin', '<span class="meta danger post-gap">Rellena los huecos {{…}} del texto antes de aprobarlo.</span>'));
    document.querySelector<HTMLTextAreaElement>(`[data-post-edit="${msgId}"]`)?.focus();
    return;
  }
  card.forEach((el) => (el.innerHTML = `<span class="meta">${yes ? 'Haciéndolo…' : 'Descartando…'}</span>`));
  try {
    await api(`/api/apps/actions/${actionId}`, 'PUT', { action: yes ? 'approve' : 'reject', ...(yes && edited !== undefined ? { text: edited } : {}) });
    closeMessage(msgId);
  } catch (e) {
    card.forEach((el) => (el.innerHTML = `<span class="meta danger">${esc(e instanceof Error ? e.message : 'No salió')}</span>`));
  }
}

/** Message buttons work wherever a card is (the tab, the pop-ups). */
export function bindInbox(): void {
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-msg-act]');
    if (b) act(b.dataset.msg!, b.dataset.msgAct!);
  });

  // New messages, bottom left, until you close them or act on them.
  const box = document.createElement('div');
  box.className = 'toasts';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Avisos para ti');
  box.setAttribute('aria-live', 'polite');
  document.body.append(box);
  let shown = '';
  const sync = () => {
    const fresh = getState().inbox.filter((m) => !m.read);
    const list = fresh.slice(0, MAX_TOASTS);
    const more = fresh.length - list.length;
    const html = list.length
      ? `${list
          .reverse()
          .map((m) => messageCard(m, true))
          .join('')}${more > 0 ? `<button class="toast-more" type="button" data-open-inbox>${more} aviso${more > 1 ? 's' : ''} más en «Para ti»</button>` : ''}`
      : '';
    if (html === shown) return;
    shown = html;
    box.innerHTML = html;
  };
  subscribe(sync);
  sync();
}
