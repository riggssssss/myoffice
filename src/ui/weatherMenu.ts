import { onLayoutChange, outdoorStyle, setOutdoor, SKIES, type SkyKind } from '../sim/layout';
import { liveLabel } from '../scene/weather';
import { esc } from './dom';
import { icon } from './icons';

/**
 * The weather, up in the top bar: what the sky is doing and a menu to change it (Auto follows
 * the real weather where you are). Changes roll in gradually, as weather does.
 */
const ICON: Record<SkyKind, (s?: number) => string> = {
  auto: icon.skyAuto,
  clear: icon.skyClear,
  overcast: icon.skyOvercast,
  rain: icon.skyRain,
  storm: icon.skyStorm,
};

export function setupWeatherMenu(): void {
  const btn = document.getElementById('sky')!;
  const menu = document.createElement('div');
  menu.className = 'sky-menu';
  menu.id = 'sky-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Tiempo');
  document.body.append(menu);
  btn.setAttribute('aria-controls', menu.id);

  const label = () => {
    const sky = outdoorStyle().sky;
    const name = SKIES.find((k) => k.id === sky)!.label;
    // In Auto, what it's actually doing (e.g. «Madrid: lluvia»).
    const live = sky === 'auto' ? liveLabel() : null;
    btn.innerHTML = `${ICON[sky](16)}<span class="sky-btn-text"><span class="sky-btn-kind">Tiempo</span><span class="sky-btn-value">${esc(live ? `Auto · ${live.split(': ').pop()}` : name)}</span></span>`;
    btn.setAttribute('aria-label', `Tiempo: ${live ? `automático, ${live}` : name}`);
    btn.title = live ? `Automático · ${live}` : name;
  };

  const render = () => {
    const sky = outdoorStyle().sky;
    menu.innerHTML = SKIES.map(
      (k) => `
      <button class="sky-item" type="button" role="menuitemradio" aria-checked="${k.id === sky}" data-sky="${k.id}" tabindex="-1">
        ${ICON[k.id](16)}
        <span class="sky-item-text"><strong>${esc(k.label)}</strong><span class="meta">${esc((k.id === 'auto' && liveLabel()) || k.note)}</span></span>
        ${k.id === sky ? icon.tick(14) : ''}
      </button>`,
    ).join('');
  };

  const items = () => [...menu.querySelectorAll<HTMLElement>('[data-sky]')];
  const place = () => {
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.left = `${Math.max(12, Math.min(window.innerWidth - menu.offsetWidth - 12, r.left))}px`;
  };
  const toggle = (open: boolean, focus = false) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    render();
    place();
    if (focus) (items().find((b) => b.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(menu.hidden === true, e.detail === 0);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      toggle(true, true);
    }
  });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sky]');
    if (!b) return;
    setOutdoor({ sky: b.dataset.sky as SkyKind });
    toggle(false);
    btn.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1].focus();
    } else if (e.key === 'Tab') toggle(false);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) toggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      toggle(false);
      btn.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (!menu.hidden) place();
  });

  const refresh = () => {
    label();
    if (!menu.hidden) render();
  };
  onLayoutChange(refresh);
  window.addEventListener('weather-change', refresh);
  label();
}
