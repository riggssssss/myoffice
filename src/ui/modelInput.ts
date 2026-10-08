import { PROVIDERS, type TextProvider } from '../sim/settings';
import { esc } from './dom';

/**
 * Picks a model for one provider: a list for Claude, a free field with suggestions for the
 * others (their catalogues change often). `inherit` names the model used when left empty.
 */
export function modelInput(id: string, provider: TextProvider, value: string | null, attrs: string, inherit?: string): string {
  const { models, defaultModel } = PROVIDERS[provider];
  if (provider === 'anthropic') {
    return `
      <select id="${id}" ${attrs}>
        ${inherit ? `<option value="" ${value ? '' : 'selected'}>${esc(inherit)}</option>` : ''}
        ${models.map((m) => `<option value="${m.id}" ${m.id === value ? 'selected' : ''}>${m.label}${inherit ? '' : ` · ${m.note}`}</option>`).join('')}
      </select>`;
  }
  const list = models.length ? `${id}-list` : '';
  return `
    <input id="${id}" ${attrs} value="${esc(value ?? '')}" placeholder="${esc(inherit ?? `Ej. ${defaultModel}`)}" ${list ? `list="${list}"` : ''} maxlength="80" autocomplete="off" spellcheck="false" />
    ${list ? `<datalist id="${list}">${models.map((m) => `<option value="${m.id}">${m.label} · ${m.note}</option>`).join('')}</datalist>` : ''}`;
}
