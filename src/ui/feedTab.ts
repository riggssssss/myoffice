import { getState, select } from '../sim/store';
import { esc, stamp } from './dom';
import { feedIcon } from './icons';

const SHOWN = 80;

export function renderFeed(): string {
  const items = getState().feed.slice(0, SHOWN);
  if (!items.length) return `<p class="section-note">Cuando el equipo empiece a moverse, aparecerá aquí.</p>`;
  return `<ol class="feed" aria-label="Actividad reciente">${items
    .map((e) => {
      const body = `<span class="feed-icon feed-${e.kind}">${feedIcon(e.kind, 14)}</span><span class="feed-text">${esc(e.text)}</span><span class="num muted">${stamp(e.t)}</span>`;
      return e.workerId
        ? `<li><button type="button" class="feed-row" data-who="${e.workerId}" data-key="ev-${e.id}">${body}</button></li>`
        : `<li><div class="feed-row">${body}</div></li>`;
    })
    .join('')}</ol>`;
}

export function bindFeed(el: HTMLElement, showTeam: () => void): void {
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-who]');
    if (!b) return;
    select(b.dataset.who!);
    showTeam();
  });
}
