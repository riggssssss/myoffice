import { getState, subscribe } from '../sim/store';
import { modelLabel, PROVIDERS, type TextProvider } from '../sim/settings';
import type { AiReason, AiStatus } from '../sim/types';
import { openSettingsAt } from './config';
import { esc } from './dom';

/**
 * How the office's AI is doing, always in view in the top bar: a dot and a word when all is
 * well, and when it isn't, what happened in plain words, what stops meanwhile, when it comes
 * back by itself and what you can do about it.
 */

/** Where to top up each provider's account. */
const BILLING: Partial<Record<TextProvider, string>> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  groq: 'https://console.groq.com/settings/billing',
};

const time = (ms: number) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(ms);

/** When it comes back, said the way you'd say it. */
function backIn(ms: number | null): string {
  if (!ms) return '';
  const mins = Math.max(1, Math.round((ms - Date.now()) / 60_000));
  if (mins < 2) return 'en un momento';
  if (mins < 60) return `en unos ${mins} min (a las ${time(ms)})`;
  return `a las ${time(ms)}`;
}

interface View {
  tone: 'ok' | 'warn' | 'bad';
  chip: string;
  title: string;
  body: string;
  /** What to do: opening Ajustes → IA, and maybe a link to top up. */
  billing?: string;
}

function view(ai: AiStatus): View {
  const who = ai.resting.length ? [...ai.resting].sort((a, b) => a.until - b.until)[0] : null;
  const name = who ? `${PROVIDERS[who.provider].label} (${modelLabel(who)})` : 'tu IA';
  const back = backIn(ai.back);
  const reasons: Record<AiReason, Omit<View, 'tone'>> = {
    nokey: { chip: 'Sin IA', title: 'No hay ninguna IA conectada', body: 'Los agentes necesitan una IA para hablar y trabajar. Pega una clave en Ajustes → IA (Groq y NVIDIA tienen planes gratis).' },
    'office-limit': { chip: 'IA: tope de hoy', title: 'Has llegado al tope diario que pusiste', body: `Hoy se han usado ${ai.tokensToday.toLocaleString('es-ES')} de ${ai.limit.toLocaleString('es-ES')} tokens. Mañana siguen solos; si quieres que sigan hoy, sube el tope en Ajustes → IA.` },
    daily: { chip: 'IA sin cupo', title: 'Se acabó el uso gratis de hoy', body: `${name} solo deja usar gratis cierta cantidad al día y ya está gastada. Vuelve ${back || 'más tarde'}.` },
    minute: { chip: 'IA: un momento', title: 'Demasiadas peticiones seguidas', body: `${name} limita cuántas peticiones se hacen por minuto. Siguen solos ${back || 'en un momento'}; no hace falta hacer nada.` },
    credits: { chip: 'IA sin saldo', title: 'Tu cuenta de IA no tiene saldo', body: `${name} ha rechazado las peticiones por falta de crédito. Añade saldo en su web o pon otra IA en tu lista.`, billing: who ? BILLING[who.provider] : undefined },
    key: { chip: 'IA: clave mal', title: 'La clave no funciona', body: `${name} no acepta la clave: puede estar mal copiada, caducada o borrada. Pega una nueva en Ajustes → IA.` },
    model: { chip: 'IA: modelo', title: 'Ese modelo no está disponible', body: `${name} ya no ofrece ese modelo o tu cuenta no tiene acceso. Elige otro en Ajustes → IA.` },
    down: { chip: 'IA no responde', title: 'El proveedor no responde', body: `No hay respuesta de ${name}: puede ser tu conexión o una caída suya. Se reintenta solo ${back || 'en un par de minutos'}.` },
  };
  if (ai.reason) {
    const r = reasons[ai.reason];
    const tone = ai.reason === 'minute' ? 'warn' : ai.state === 'ready' ? 'warn' : 'bad';
    return { tone, ...r };
  }
  if (ai.using) {
    const first = ai.resting[0];
    return {
      tone: 'warn',
      chip: 'IA de reserva',
      title: 'Responde tu IA de reserva',
      body: `${first ? `${PROVIDERS[first.provider].label} (${modelLabel(first)}) está en pausa: ${first.why}.` : 'La primera de tu lista está en pausa.'} Mientras, piensan con ${PROVIDERS[ai.using.provider].label} (${modelLabel(ai.using)}). Todo sigue funcionando.`,
    };
  }
  return {
    tone: 'ok',
    chip: 'IA',
    title: 'La IA funciona',
    body: ai.limit ? `Hoy van ${ai.tokensToday.toLocaleString('es-ES')} de ${ai.limit.toLocaleString('es-ES')} tokens de tu tope diario.` : `Hoy van ${ai.tokensToday.toLocaleString('es-ES')} tokens, sin tope diario.`,
  };
}

export function setupAiStatus(): void {
  const btn = document.getElementById('ai-status')!;
  const pop = document.createElement('div');
  pop.className = 'ai-pop';
  pop.id = 'ai-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Estado de la IA');
  document.body.append(pop);
  btn.setAttribute('aria-controls', pop.id);

  let shown = '';
  const render = () => {
    const ai = getState().ai;
    const v = view(ai);
    const chip = `<span class="ai-dot is-${v.tone}" aria-hidden="true"></span><span class="ai-chip-text">${esc(v.chip)}</span>`;
    if (chip !== shown) {
      btn.innerHTML = shown = chip;
      btn.className = `ai-chip is-${v.tone}`;
      btn.setAttribute('aria-label', `IA: ${v.title}`);
      btn.title = v.title;
    }
    if (pop.hidden) return;
    const stops = v.tone === 'bad' ? '<p class="ai-pop-stops">Mientras, los agentes no hablan, no trabajan ni responden en las reuniones. Lo que tenían a medias queda guardado y siguen solos cuando vuelva.</p>' : '';
    const tip = v.tone !== 'ok' && !ai.using ? '<p class="ai-pop-tip">Para que no se paren: añade una segunda IA a tu lista. Cuando una se agota, la siguiente toma el relevo sola.</p>' : '';
    pop.innerHTML = `
      <p class="ai-pop-title"><span class="ai-dot is-${v.tone}" aria-hidden="true"></span>${esc(v.title)}</p>
      <p class="ai-pop-body">${esc(v.body)}</p>
      ${stops}${tip}
      <div class="ai-pop-actions">
        ${v.billing ? `<a class="btn btn-sm btn-primary" href="${v.billing}" target="_blank" rel="noopener noreferrer">Añadir saldo</a>` : ''}
        <button class="btn btn-sm ${v.billing || v.tone === 'ok' ? 'btn-ghost' : 'btn-primary'}" type="button" data-ai-settings>${v.tone === 'ok' ? 'Ajustes de IA' : 'Abrir Ajustes → IA'}</button>
      </div>`;
  };

  const place = () => {
    const r = btn.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pop.offsetWidth - 12, r.right - pop.offsetWidth))}px`;
  };
  const toggle = (open: boolean) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      place();
    }
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(pop.hidden === true);
  });
  pop.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-ai-settings]')) {
      toggle(false);
      openSettingsAt('ai');
    }
  });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target as Node)) toggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      toggle(false);
      btn.focus();
    }
  });
  subscribe(render);
  // The «back in N min» counts down even when nothing else changes.
  setInterval(render, 30_000);
  render();
}
