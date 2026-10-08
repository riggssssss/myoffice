/**
 * One change to a file of your real project: who, why, and the difference line by line.
 * Pending ones can be applied or discarded; applied ones undone.
 */
import type { ChangeStatus, ProjectChange } from '../sim/project';
import { api } from '../sim/store';
import { esc, stamp } from './dom';
import { icon } from './icons';

export const CHANGE_STATUS: Record<ChangeStatus, string> = {
  open: 'Esperando tu decisión',
  applied: 'Aplicado',
  rejected: 'Descartado',
  failed: 'No se pudo aplicar',
  undone: 'Deshecho',
};

type Line = { t: ' ' | '+' | '-'; s: string };

/** Line diff (longest common subsequence), trimmed to what changed. Huge files: whole-file swap. */
function diff(before: string, after: string): Line[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const A = a.slice(p, a.length - q);
  const B = b.slice(p, b.length - q);
  const same = (xs: string[]): Line[] => xs.map((s) => ({ t: ' ', s }));
  let mid: Line[];
  if (A.length * B.length > 4_000_000) mid = [...A.map((s): Line => ({ t: '-', s })), ...B.map((s): Line => ({ t: '+', s }))];
  else {
    const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    mid = [];
    let i = 0;
    let j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) {
        mid.push({ t: ' ', s: A[i++] });
        j++;
      } else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) mid.push({ t: '+', s: B[j++] });
      else mid.push({ t: '-', s: A[i++] });
    }
  }
  return [...same(a.slice(0, p)), ...mid, ...same(a.slice(a.length - q))];
}

/** Changed lines with three lines around them; long unchanged stretches fold away. */
function diffHtml(c: ProjectChange): string {
  const lines = c.before === null ? c.after.split('\n').map((s): Line => ({ t: '+', s })) : diff(c.before, c.after);
  const near = lines.map((_, i) => lines.slice(Math.max(0, i - 3), i + 4).some((l) => l.t !== ' '));
  const out: string[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (!near[i]) return void skipped++;
    if (skipped) out.push(`<span class="diff-skip">··· ${skipped} línea${skipped > 1 ? 's' : ''} sin cambios</span>`);
    skipped = 0;
    out.push(`<span class="diff-${l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'}">${l.t} ${esc(l.s) || ' '}</span>`);
  });
  if (skipped) out.push(`<span class="diff-skip">··· ${skipped} línea${skipped > 1 ? 's' : ''} sin cambios</span>`);
  return `<pre class="diff" tabindex="0" aria-label="Diferencias">${out.join('')}</pre>`;
}

export async function openChange(id: string): Promise<void> {
  const d = document.getElementById('change-dialog') as HTMLDialogElement;
  let c: ProjectChange;
  try {
    c = await api<ProjectChange>(`/api/project/changes/${id}`);
  } catch {
    return;
  }
  let problem = '';
  let busy = false;
  const render = () => {
    const open = c.status === 'open' || c.status === 'failed';
    d.innerHTML = `
      <div class="dialog-form change">
        <header class="dialog-head">
          <h2 id="change-title">${c.before === null ? 'Archivo nuevo' : 'Cambio'} en tu proyecto</h2>
          <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
        </header>
        <p class="change-path"><code>${esc(c.path)}</code></p>
        <p class="meta">${esc(c.byName)} · <span class="num">${stamp(c.at)}</span> · <span class="change-status is-${c.status}">${CHANGE_STATUS[c.status]}</span></p>
        <p class="change-reason">${esc(c.reason)}</p>
        ${c.note ? `<p class="field-error" role="alert">${esc(c.note)}</p>` : ''}
        ${diffHtml(c)}
        ${problem ? `<p class="field-error" role="alert">${esc(problem)}</p>` : ''}
        <footer class="dialog-foot">
          ${open ? `<button class="btn btn-ghost" type="button" data-change="reject" ${busy ? 'disabled' : ''}>Descartar</button><button class="btn btn-primary" type="button" data-change="apply" ${busy ? 'disabled' : ''}>${icon.tick(15)}Aplicar en el proyecto</button>` : ''}
          ${c.status === 'applied' ? `<button class="btn" type="button" data-change="undo" ${busy ? 'disabled' : ''}>${icon.undo(15)}Deshacer</button>` : ''}
        </footer>
      </div>`;
  };
  d.onclick = async (e) => {
    const t = e.target as HTMLElement;
    if (t === d || t.closest('[data-close]')) return d.close();
    const b = t.closest<HTMLElement>('[data-change]');
    if (!b || busy) return;
    busy = true;
    problem = '';
    render();
    try {
      c = await api<ProjectChange>(`/api/project/changes/${id}`, 'PUT', { action: b.dataset.change });
    } catch (err) {
      problem = (err as Error).message;
      c = await api<ProjectChange>(`/api/project/changes/${id}`).catch(() => c);
    }
    busy = false;
    render();
  };
  render();
  d.setAttribute('aria-labelledby', 'change-title');
  if (!d.open) d.showModal();
}
