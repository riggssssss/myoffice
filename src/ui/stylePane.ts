/**
 * Estilo, in the art director's file: the living style guide (what they've learnt from your
 * references, with the measured palette) and the references themselves, each with its analysis,
 * what you think of it and the way to add more.
 */
import { STYLE_SECTIONS, type StyleGuide, type StyleRef, type StyleView } from '../sim/style';
import { api, fileUrl, upload } from '../sim/store';
import type { Worker } from '../sim/types';
import { esc } from './dom';
import { icon } from './icons';
import { paletteFromBlob, prepImage } from './imagePrep';

let view: StyleView | null = null;
let loading = false;
let failed = '';
let uploading = 0;
const urls = new Map<string, string>();
const asked = new Set<string>();
let redraw: () => void = () => {};

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    view = await api<StyleView>('/api/refs');
    failed = '';
  } catch (e) {
    failed = e instanceof Error ? e.message : 'No se pudo cargar';
  }
  loading = false;
  redraw();
}

document.addEventListener('refs-changed', () => void load());

/** A reference's picture: from the cache, or fetched (with the session's token) and drawn again. */
function pic(r: StyleRef): string {
  const url = urls.get(r.fileId);
  if (url) return `<img src="${url}" alt="${esc(r.name)}" loading="lazy" />`;
  if (!asked.has(r.fileId)) {
    asked.add(r.fileId);
    void fileUrl(r.fileId)
      .then(async (u) => {
        urls.set(r.fileId, u);
        // Arrived without its colours (sent before this existed): measure them now.
        if (!r.palette.length) {
          const blob = await fetch(u).then((x) => x.blob());
          const palette = await paletteFromBlob(blob);
          if (palette.length) void api(`/api/refs/${r.id}`, 'PUT', { palette }).catch(() => {});
        }
        redraw();
      })
      .catch(() => {});
  }
  return '<span class="ref-pic-wait" aria-hidden="true"></span>';
}

const swatches = (list: { hex: string }[], cls = '') =>
  list.length ? `<span class="guide-swatches ${cls}">${list.map((s) => `<span class="guide-swatch" style="--c:${s.hex}" title="${s.hex}"></span>`).join('')}</span>` : '';

function guideBlock(g: StyleGuide | null, thinking: boolean, ready: number): string {
  const head = `
    <div class="guide-head">
      <h3 class="section-title">Guía de estilo${g ? ` <span class="count">v${g.version}</span>` : ''}</h3>
      ${thinking ? `<span class="meta guide-busy"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>Reescribiendo con lo nuevo…</span>` : ''}
    </div>`;
  if (!g) {
    return `${head}<p class="section-note">${
      ready ? 'Se escribe sola en unos segundos con las referencias analizadas.' : 'Aún no hay guía. Mándale referencias (en su chat o aquí abajo): las analiza a fondo y escribe la guía que seguirá todo el equipo y cada imagen que se genere.'
    }</p>`;
  }
  const mine = (id: string, line: string) => (g.owner[id as keyof typeof g.owner] ?? []).includes(line);
  return `
    ${head}
    ${g.palette.length ? `<div class="guide-palette">${swatches(g.palette.map((hex) => ({ hex })), 'is-lg')}<span class="meta">${g.palette.join(' · ')}</span></div>` : ''}
    <div class="guide">
      ${STYLE_SECTIONS.filter((s) => g.sections[s.id].length)
        .map(
          (s) => `
          <section class="guide-sec${s.id === 'evitar' ? ' is-avoid' : ''}">
            <h4>${esc(s.label)}</h4>
            <ul>${g.sections[s.id].map((l) => `<li${mine(s.id, l) ? ' class="is-mine" title="Escrita por ti: se queda tal cual"' : ''}>${esc(l)}</li>`).join('')}</ul>
          </section>`,
        )
        .join('')}
    </div>
    ${g.prompt ? `<details class="guide-prompt"><summary>Lo que se añade a cada imagen (en inglés)</summary><p>${esc(g.prompt)}</p></details>` : ''}
    <div class="actions">
      <button class="btn btn-sm" type="button" data-guide-edit data-key="guide-edit">${icon.edit(14)}Editar guía</button>
      <button class="btn btn-sm" type="button" data-guide-rebuild data-key="guide-rebuild" ${thinking ? 'disabled' : ''}>${icon.refresh(14)}Rehacer con todas</button>
      <button class="btn btn-ghost btn-sm" type="button" data-guide-undo data-key="guide-undo">Deshacer último cambio</button>
    </div>`;
}

const STATUS: Record<StyleRef['status'], string> = { pending: 'En cola', analyzing: 'Analizando…', ready: 'Analizada', failed: 'No salió' };

function refCard(r: StyleRef): string {
  const a = r.analysis;
  const facts = a
    ? [
        ['Luz', [a.lighting.key, a.lighting.hardness, a.lighting.colorTemp, a.lighting.shadows].filter(Boolean).join(' · ')],
        ['Color', [a.color.contrast, a.color.saturation, a.color.whiteBalance, a.color.grading].filter(Boolean).join(' · ')],
        ['Cámara', [a.composition.shot, a.composition.angle, a.composition.lens, a.composition.depthOfField].filter(Boolean).join(' · ')],
        ['Escena', [a.scene.setting, a.scene.props.join(', '), a.materials.join(', ')].filter(Boolean).join(' · ')],
        ['Mood', a.mood],
        ['Funciona', a.works.join('; ')],
        ['Evitar', a.avoid.join('; ')],
      ].filter(([, v]) => v)
    : [];
  return `
    <li class="ref is-${r.status}${r.verdict ? ` is-${r.verdict}` : ''}">
      <div class="ref-pic">${pic(r)}${swatches(r.palette)}</div>
      <div class="ref-body">
        <p class="ref-status meta">${r.status === 'analyzing' ? '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}${STATUS[r.status]}${r.from === 'chat' ? ' · del chat' : ''}</p>
        ${a ? `<p class="ref-summary">${esc(a.summary)}</p>` : ''}
        ${r.error ? `<p class="field-error">${esc(r.error)}</p>` : ''}
        ${
          facts.length
            ? `<details class="ref-more"><summary>Análisis</summary><dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`
            : ''
        }
        <div class="ref-actions">
          <button class="btn btn-sm ref-vote${r.verdict === 'like' ? ' is-on' : ''}" type="button" data-ref-vote="${r.id}" data-v="like" aria-pressed="${r.verdict === 'like'}" data-key="like-${r.id}">${icon.tick(13)}Me gusta</button>
          <button class="btn btn-sm ref-vote${r.verdict === 'dislike' ? ' is-on' : ''}" type="button" data-ref-vote="${r.id}" data-v="dislike" aria-pressed="${r.verdict === 'dislike'}" data-key="dislike-${r.id}">${icon.close(13)}No</button>
          ${r.status === 'failed' ? `<button class="btn btn-sm" type="button" data-ref-retry="${r.id}" data-key="retry-${r.id}">${icon.refresh(13)}Reintentar</button>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" data-ref-remove="${r.id}" data-key="rm-${r.id}" aria-label="Quitar esta referencia">Quitar</button>
        </div>
      </div>
    </li>`;
}

export function stylePane(_w: Worker): string {
  if (!view && !loading && !failed) void load();
  if (!view) return failed ? `<p class="field-error">${esc(failed)}</p>` : '<p class="section-note">Cargando…</p>';
  const ready = view.refs.filter((r) => r.status === 'ready').length;
  return `
    <section class="section style-pane">
      ${guideBlock(view.guide, view.thinking, ready)}
    </section>
    <section class="section">
      <div class="guide-head">
        <h3 class="section-title">Referencias <span class="count">${view.refs.length}</span></h3>
        <label class="btn btn-sm${uploading ? ' is-busy' : ''}" data-key="ref-upload">
          ${icon.image(14)}${uploading ? `Subiendo ${uploading}…` : 'Subir referencias'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-ref-files />
        </label>
      </div>
      <p class="section-note">Las que le mandas en su chat también entran aquí. «Me gusta» pesa el doble en la guía; «No» solo le enseña qué evitar. Las imágenes se envían a la IA que las analiza (la suya o, si no ve imágenes, la de Groq o NVIDIA).</p>
      ${view.refs.length ? `<ul class="refs">${view.refs.map(refCard).join('')}</ul>` : ''}
    </section>`;
}

/** The guide by hand: one box per section (a line each); what you write stays fixed. */
function editGuide(): void {
  const g = view?.guide;
  const d = document.getElementById('task-dialog') as HTMLDialogElement;
  d.innerHTML = `
    <form method="dialog" class="dialog-form guide-form" novalidate>
      <header class="dialog-head">
        <h2>Editar la guía de estilo</h2>
        <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
      </header>
      <p class="section-note">Una línea por idea. Lo que escribas o cambies queda fijado: dirección de arte lo mantiene tal cual al aprender de nuevas referencias.</p>
      ${STYLE_SECTIONS.map(
        (s) => `
        <div class="field">
          <label for="g-${s.id}">${esc(s.label)}</label>
          <textarea id="g-${s.id}" name="${s.id}" rows="3">${esc((g?.sections[s.id] ?? []).join('\n'))}</textarea>
        </div>`,
      ).join('')}
      <div class="field">
        <label for="g-prompt">Lo que se añade a cada imagen (en inglés)</label>
        <textarea id="g-prompt" name="prompt" rows="4" maxlength="700">${esc(g?.prompt ?? '')}</textarea>
      </div>
      <p class="field-error" hidden data-guide-error></p>
      <footer class="dialog-foot">
        <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit">Guardar</button>
      </footer>
    </form>`;
  const form = d.querySelector('form')!;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const sections = Object.fromEntries(STYLE_SECTIONS.map((s) => [s.id, String(data.get(s.id) ?? '').split('\n').map((l) => l.trim()).filter(Boolean)]));
    try {
      view = await api<StyleView>('/api/style', 'PUT', { sections, prompt: String(data.get('prompt') ?? '').trim() });
      d.close();
      redraw();
    } catch (err) {
      const el = d.querySelector<HTMLElement>('[data-guide-error]')!;
      el.textContent = err instanceof Error ? err.message : 'No se pudo guardar';
      el.hidden = false;
    }
  });
  d.showModal();
}

async function addFiles(files: File[]): Promise<void> {
  uploading = files.length;
  redraw();
  for (const f of files.slice(0, 12)) {
    try {
      const prep = await prepImage(f);
      const saved = await upload(prep.file, undefined, prep.palette);
      await api('/api/refs', 'POST', { fileId: saved.id, palette: prep.palette });
    } catch (e) {
      failed = e instanceof Error ? e.message : 'No se pudo subir';
    }
    uploading--;
    redraw();
  }
  uploading = 0;
  await load();
}

/** Clicks and file picks in the Estilo tab. True when it was one of theirs. */
export function styleClick(t: HTMLElement): boolean {
  if (t.closest('[data-guide-edit]')) return editGuide(), true;
  if (t.closest('[data-guide-rebuild]')) return void api('/api/style/rebuild', 'POST').catch(() => {}), true;
  if (t.closest('[data-guide-undo]')) return void api<StyleView>('/api/style/undo', 'POST').then((v) => ((view = v), redraw())).catch(() => {}), true;
  const vote = t.closest<HTMLElement>('[data-ref-vote]');
  if (vote) {
    const r = view?.refs.find((x) => x.id === vote.dataset.refVote);
    if (r) {
      r.verdict = r.verdict === vote.dataset.v ? null : (vote.dataset.v as StyleRef['verdict']);
      redraw();
      void api(`/api/refs/${r.id}`, 'PUT', { verdict: r.verdict }).catch(() => load());
    }
    return true;
  }
  const retry = t.closest<HTMLElement>('[data-ref-retry]');
  if (retry) return void api(`/api/refs/${retry.dataset.refRetry}/analyze`, 'POST').catch(() => {}), true;
  const rm = t.closest<HTMLElement>('[data-ref-remove]');
  if (rm) {
    if (view) view.refs = view.refs.filter((r) => r.id !== rm.dataset.refRemove);
    redraw();
    void api(`/api/refs/${rm.dataset.refRemove}`, 'DELETE').catch(() => load());
    return true;
  }
  return false;
}

export function styleChange(t: HTMLElement): boolean {
  const input = t.closest<HTMLInputElement>('[data-ref-files]');
  if (!input?.files?.length) return false;
  void addFiles([...input.files]);
  input.value = '';
  return true;
}

export function bindStyle(rerender: () => void): void {
  redraw = rerender;
}
