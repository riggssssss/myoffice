/**
 * A field for one secret (an API key, a token). Write-only: once saved the page only ever
 * learns that it exists and its last four characters; the value stays in the server's vault.
 */
import type { TextProvider } from '../sim/settings';
import { api } from '../sim/store';
import { esc } from './dom';

export interface SecretInfo {
  name: string;
  last4: string;
}

let secrets: SecretInfo[] = [];
/** Fields the person asked to change: shown as an input even though a value is saved. */
const editing = new Set<string>();

export async function loadSecrets(): Promise<SecretInfo[]> {
  secrets = await api<SecretInfo[]>('/api/secrets');
  return secrets;
}

export const hasSecret = (name: string) => secrets.some((s) => s.name === name);

/** «Does it work?» per key: asked of the server, which tries it with one tiny request. */
type Check = { state: 'testing' | 'works' | 'busy' | 'bad'; text: string };
const checks = new Map<string, Check>();
/** Which AI provider each key belongs to (keys that can be tried). */
const providerOf = new Map<string, TextProvider>();

async function check(name: string, changed: () => void): Promise<void> {
  const provider = providerOf.get(name);
  if (!provider) return;
  checks.set(name, { state: 'testing', text: 'Comprobando…' });
  changed();
  try {
    const r = await api<{ ok: boolean; result: string; detail: string }>('/api/ai/test', 'POST', { provider });
    checks.set(name, { state: r.result === 'works' ? 'works' : r.result === 'busy' ? 'busy' : 'bad', text: r.result === 'works' ? 'Funciona' : r.detail });
  } catch {
    checks.set(name, { state: 'bad', text: 'No se pudo comprobar: ¿está en marcha el servidor local?' });
  }
  changed();
}
export const secretTail = (name: string) => secrets.find((s) => s.name === name)?.last4 ?? '';

export function keyField(
  name: string,
  label: string,
  opts: { help?: string; optional?: boolean; test?: TextProvider; placeholder?: string } = {},
): string {
  const saved = secrets.find((s) => s.name === name);
  if (opts.test) providerOf.set(name, opts.test);
  const c = checks.get(name);
  const status = !opts.test
    ? ''
    : c
      ? `<span class="key-check is-${c.state}" role="status">${c.state === 'works' ? '✓ ' : c.state === 'bad' ? '✕ ' : ''}${esc(c.text)}</span>`
      : '';
  const id = `key-${name}`;
  const help = opts.help ? ` <a href="${esc(opts.help)}" target="_blank" rel="noopener noreferrer">Conseguirla</a>` : '';
  if (saved && !editing.has(name)) {
    return `
      <div class="key-field is-set" data-key-name="${name}">
        <span class="key-label">${esc(label)}</span>
        <span class="key-row">
          <span class="key-state">Guardada${saved.last4 ? ` · <span class="num">····${esc(saved.last4)}</span>` : ''}</span>
          ${opts.test ? `<button class="btn btn-ghost btn-sm" type="button" data-key-test ${c?.state === 'testing' ? 'disabled' : ''}>Probar</button>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" data-key-edit>Cambiar</button>
          <button class="btn btn-ghost btn-sm btn-danger-text" type="button" data-key-del>Quitar</button>
        </span>
        ${status}
      </div>`;
  }
  return `
    <div class="key-field" data-key-name="${name}">
      <label class="key-label" for="${id}">${esc(label)}${opts.optional ? ' <span class="muted">(opcional)</span>' : ''}${help}</label>
      <span class="key-row">
        <input id="${id}" type="password" autocomplete="off" spellcheck="false" data-key-input placeholder="${esc(opts.placeholder ? `Pega aquí la clave (${opts.placeholder})` : 'Pega aquí la clave')}" />
        <button class="btn btn-sm" type="button" data-key-save>Guardar</button>
        ${saved ? '<button class="btn btn-ghost btn-sm" type="button" data-key-cancel>Cancelar</button>' : ''}
      </span>
      <p class="field-error" hidden></p>
    </div>`;
}

/** Wires every key field inside `root`; `changed` re-renders once a key is saved or removed. */
export function bindKeyFields(root: HTMLElement, changed: () => void): void {
  root.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const field = t.closest<HTMLElement>('[data-key-name]');
    if (!field) return;
    const name = field.dataset.keyName!;
    if (t.closest('[data-key-edit]')) {
      editing.add(name);
      changed();
      field.ownerDocument.getElementById(`key-${name}`)?.focus();
      return;
    }
    if (t.closest('[data-key-cancel]')) {
      editing.delete(name);
      return changed();
    }
    if (t.closest('[data-key-del]')) {
      secrets = await api<SecretInfo[]>(`/api/secrets/${name}`, 'DELETE');
      checks.delete(name);
      return changed();
    }
    if (t.closest('[data-key-test]')) return check(name, changed);
    if (t.closest('[data-key-save]')) await save(field, name, changed);
  });
  root.addEventListener('keydown', async (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-key-input]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    const field = input.closest<HTMLElement>('[data-key-name]')!;
    await save(field, field.dataset.keyName!, changed);
  });
}

async function save(field: HTMLElement, name: string, changed: () => void): Promise<void> {
  const input = field.querySelector<HTMLInputElement>('[data-key-input]')!;
  const error = field.querySelector<HTMLElement>('.field-error')!;
  const value = input.value.trim();
  if (!value) {
    error.textContent = 'Pega la clave antes de guardar.';
    error.hidden = false;
    return;
  }
  try {
    secrets = await api<SecretInfo[]>(`/api/secrets/${name}`, 'PUT', { value });
    input.value = '';
    editing.delete(name);
    changed();
    // Saved: try it straight away, so you know it works.
    void check(name, changed);
  } catch {
    error.textContent = 'No se pudo guardar. ¿Está en marcha el servidor local?';
    error.hidden = false;
  }
}
