import { getState, subscribe } from '../sim/store';
import { esc } from './dom';
import { icon } from './icons';
import { briefList } from './meetingPanel';

/**
 * Wherever the agents mention "the dossier", the word is a link to it: what the office knows
 * about your product, aspect by aspect, kept up to date while it's open.
 */
export function linkDossier(escaped: string): string {
  return escaped.replace(/\b(dos+ier)\b/gi, '<button type="button" class="link" data-open-dossier>$1</button>');
}

const dialog = () => document.getElementById('dossier-dialog') as HTMLDialogElement;

function render(d: HTMLDialogElement): void {
  const brief = getState().brief;
  const clear = Object.values(brief.aspects).filter((a) => a && a.confidence >= 0.6).length;
  const body = `
    <div class="dialog-form">
      <header class="dialog-head">
        <h2 id="dossier-title">Lo que saben del producto</h2>
        <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
      </header>
      <p class="section-note">El dossier: lo que les has contado en las reuniones, apartado por apartado y con lo seguros que están. Todos lo leen antes de hablar o trabajar, y de él sale la claridad de la salud del proyecto. Ahora tienen <span class="num">${clear}</span> de 9 apartados claros.</p>
      ${briefList()}
      ${rulings(brief)}
    </div>`;
  if (d.dataset.html !== body) {
    d.dataset.html = body;
    d.innerHTML = body;
  }
}

/** What you've decided and the webs you've passed: the team reads these first, and won't ask about them again. */
function rulings(brief: ReturnType<typeof getState>['brief']): string {
  const yours = brief.yours ?? [];
  const ruled = brief.rulings ?? [];
  const links = brief.links ?? [];
  const decided = yours.length || ruled.length
    ? `<section class="dossier-more" aria-labelledby="dossier-ruled">
        <h3 class="section-title" id="dossier-ruled">Lo que has decidido tú</h3>
        <ul class="dossier-list">
          ${yours.map((t) => `<li>${esc(t)}: lo llevas tú</li>`).join('')}
          ${ruled.map((r) => `<li>${esc(r.text)}</li>`).join('')}
        </ul>
      </section>`
    : '';
  const webs = links.length
    ? `<section class="dossier-more" aria-labelledby="dossier-webs">
        <h3 class="section-title" id="dossier-webs">Webs que les has pasado</h3>
        <ul class="dossier-list">
          ${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title || new URL(l.url).hostname)}</a> <span class="dossier-host">${esc(new URL(l.url).hostname)}</span></li>`).join('')}
        </ul>
      </section>`
    : '';
  return decided + webs;
}

export function openDossier(): void {
  const d = dialog();
  render(d);
  if (!d.open) d.showModal();
}

/** Once: links anywhere open it; it follows the dossier while it's open. */
export function bindDossier(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-open-dossier]')) return openDossier();
    const d = dialog();
    if (d.open && (t === d || (d.contains(t) && t.closest('[data-close]')))) d.close();
  });
  subscribe(() => {
    const d = dialog();
    if (d.open) render(d);
  });
}
