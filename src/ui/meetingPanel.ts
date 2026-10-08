import { ROLES } from '../sim/seed';
import { endMeeting, getState, ownerSay, worker } from '../sim/store';
import type { BriefAspect, Meeting } from '../sim/types';
import { esc, stamp } from './dom';
import { linkDossier } from './dossier';
import { icon } from './icons';

const KIND: Record<Meeting['kind'], string> = {
  kickoff: 'Empieza la historia',
  review: 'Reunión contigo',
  crisis: 'Reunión de crisis',
};

/** Same aspects the server keeps, in the order they're asked about. */
export const BRIEF_LABELS: [BriefAspect, string][] = [
  ['que', 'Qué es el producto'],
  ['para_quien', 'Para quién es'],
  ['problema', 'Qué problema resuelve'],
  ['objetivos', 'Objetivos y cómo se mide el éxito'],
  ['estado', 'En qué punto está'],
  ['canales', 'Dónde se vende y se comunica'],
  ['marca', 'Marca y tono'],
  ['restricciones', 'Presupuesto, plazos y límites'],
  ['prioridades', 'Prioridades ahora'],
];

const face = (id: string) => {
  const w = worker(id);
  return `<span class="talk-dot" style="--role:${w ? ROLES[w.role].color : '#999'}">${esc((w?.name ?? '?').charAt(0))}</span>`;
};

function lead(m: Meeting): string {
  const names = m.participants.map((id) => worker(id)?.name ?? '').filter(Boolean);
  if (m.status === 'gathering') return `${names.join(' y ')} van hacia la sala de reuniones.`;
  if (m.status === 'closing') return 'La reunión ha terminado: la dirección está escribiendo el acta.';
  if (m.kind === 'kickoff') return 'Cuéntales tu producto con tus palabras: qué es, para quién, en qué punto está. Te irán preguntando lo que falte.';
  if (m.kind === 'crisis') return `La salud del proyecto está en el ${getState().health.overall} % y el trabajo está en pausa. Te explican qué pasa y qué necesitan.`;
  return 'Habla de lo que quieras revisar o cambiar; te responderán con lo que saben.';
}

export function briefList(): string {
  const brief = getState().brief;
  return `<ul class="brief-list">${BRIEF_LABELS.map(([id, label]) => {
    const a = brief.aspects[id];
    const pct = Math.round((a?.confidence ?? 0) * 100);
    return `<li class="${a ? '' : 'is-empty'}">
      <span class="brief-label">${label}<span class="num">${a ? `${pct} %` : '—'}</span></span>
      <span class="bar bar-thin"><i style="transform:scaleX(${pct / 100})"></i></span>
      ${a ? `<span class="brief-text">${esc(a.text)}</span>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

export function renderMeeting(): string {
  const m = getState().meeting;
  if (!m) return '';
  const think = m.thinking;
  return `
    <div class="worker meeting">
      <header class="worker-head meeting-head">
        <p class="meeting-kind">${m.kind === 'crisis' ? icon.alert(14) : icon.talk(14)}${KIND[m.kind]}</p>
        <div class="talk-head">
          <span class="talk-pair">${m.participants.map(face).join('')}</span>
          <h2 class="talk-title">${m.participants.map((id) => esc(worker(id)?.name ?? '')).join(', ')} y tú</h2>
        </div>
        <p class="section-note">${lead(m)}</p>
        ${getState().ai.state === 'paused' ? `<p class="talk-status is-paused">${esc(getState().ai.note)}</p>` : ''}
      </header>
      <div class="worker-body">
        <ol class="chat" aria-live="polite">
          ${m.lines
            .map(
              (l) => `
              <li class="chat-line ${l.speaker === 'owner' ? 'is-owner' : 'is-a'}" data-key="ml-${l.at}">
                ${l.speaker === 'owner' ? '' : face(l.speaker)}
                <div class="chat-body">
                  <p class="chat-who">${l.speaker === 'owner' ? 'Tú' : esc(worker(l.speaker)?.name ?? '')} <span class="num muted">${stamp(l.at)}</span></p>
                  ${l.tools.length ? `<ul class="chat-tools">${l.tools.map((t) => `<li>${linkDossier(esc(t.note))}</li>`).join('')}</ul>` : ''}
                  <p class="chat-text">${linkDossier(esc(l.text))}</p>
                </div>
              </li>`,
            )
            .join('')}
          ${
            think
              ? `<li class="chat-line is-thinking is-a">${face(think.who)}<div class="chat-body"><p class="chat-text"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(worker(think.who)?.name ?? '')} ${esc(think.tool ?? 'está pensando')}</p></div></li>`
              : ''
          }
        </ol>
        <details class="brief-box" data-key="brief-box">
          <summary>
            <span class="brief-box-title">Lo que saben del producto</span>
            <span class="brief-box-count num">${Object.values(getState().brief.aspects).filter((x) => x && x.confidence >= 0.6).length} de ${BRIEF_LABELS.length} claros</span>
          </summary>
          ${briefList()}
        </details>
      </div>
    </div>`;
}

/** Your box at the bottom: built once (so what you're typing survives updates), then kept in step. */
export function meetingComposer(): string {
  return `
    <form class="composer meeting-composer" data-meeting-say>
      <div class="composer-box">
        <label class="sr-only" for="meeting-say">Habla en la reunión</label>
        <textarea id="meeting-say" name="text" rows="1" maxlength="4000" placeholder="Habla en la reunión…"></textarea>
        <button class="btn btn-icon composer-send" type="submit" aria-label="Decir">${icon.send(16)}</button>
      </div>
      <div class="meeting-foot">
        <p class="composer-note" data-meeting-note></p>
        <button class="btn btn-ghost btn-sm" type="button" data-meeting-end>Terminar reunión</button>
      </div>
    </form>`;
}

export function syncMeetingComposer(form: HTMLElement): void {
  const m = getState().meeting;
  if (!m) return;
  const yourTurn = m.status === 'live' && m.waitingFor === 'owner';
  form.querySelector<HTMLButtonElement>('.composer-send')!.disabled = !yourTurn;
  form.querySelector<HTMLElement>('[data-meeting-note]')!.textContent =
    m.status === 'gathering' ? 'Se están sentando…' : m.status === 'closing' ? 'Escribiendo el acta…' : yourTurn ? 'Te toca. Enter para enviar.' : 'Están respondiendo; puedes ir escribiendo.';
  form.querySelector<HTMLElement>('[data-meeting-end]')!.hidden = m.status !== 'live';
}

export function bindMeeting(el: HTMLElement): void {
  el.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('[data-meeting-say]');
    if (!form) return;
    e.preventDefault();
    const box = form.querySelector<HTMLTextAreaElement>('textarea')!;
    const text = box.value.trim();
    const m = getState().meeting;
    if (!text || !m || m.status !== 'live' || m.waitingFor !== 'owner') return box.focus();
    ownerSay(text);
    box.value = '';
    box.style.height = '';
  });
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-meeting-end]')) endMeeting();
  });
  el.addEventListener('input', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLTextAreaElement>('.composer textarea');
    if (!box) return;
    box.style.height = '';
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
  });
  el.addEventListener('keydown', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLTextAreaElement>('.composer textarea');
    if (!box || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    box.form?.requestSubmit();
  });
}
