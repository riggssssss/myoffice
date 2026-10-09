import { guessLocation, sunPosition } from '../scene/sun';
import { config } from './config';
import { esc } from './dom';
import { icon } from './icons';
import { chosenTime, now, setChosenTime } from './now';

/**
 * The clock in the top bar opens a menu to pick the time of day the office is lit by: the real
 * time, a moment of the day worked out from the sun where you are (sunrise, noon, dusk…), or
 * any time on a slider. A picked time holds until you go back to the real one.
 */

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/** Today's sun where the office is, every 5 minutes: when it rises, peaks, sets, and the twilights. */
function moments(): { id: string; label: string; note: string; at: number; icon: (s?: number) => string }[] {
  const loc = config.settings?.location ?? guessLocation();
  const day = new Date(now());
  day.setHours(0, 0, 0, 0);
  const el = (m: number) => sunPosition(day.getTime() + m * 60_000, loc.lat, loc.lon).elevation;
  let noon = 720;
  for (let m = 0; m < 1440; m += 5) if (el(m) > el(noon)) noon = m;
  /** First time `el` crosses `deg` before noon (rising) or after it (setting). */
  const cross = (deg: number, rising: boolean, fallback: number) => {
    if (rising) {
      for (let m = 0; m <= noon; m += 5) if (el(m) >= deg) return m;
    } else {
      for (let m = noon; m < 1440; m += 5) if (el(m) <= deg) return m;
    }
    return fallback;
  };
  const sunrise = cross(0, true, 420);
  const sunset = cross(0, false, 1200);
  return [
    { id: 'night', label: 'Madrugada', note: 'Noche cerrada', at: 180, icon: icon.moon },
    { id: 'dawn', label: 'Amanecer', note: 'Sale el sol', at: sunrise, icon: icon.skyAuto },
    { id: 'morning', label: 'Mañana', note: 'Sol bajo y luz clara', at: cross(25, true, sunrise + 150), icon: icon.sun },
    { id: 'noon', label: 'Mediodía', note: 'El sol en lo más alto', at: noon, icon: icon.sun },
    { id: 'afternoon', label: 'Tarde', note: 'Luz cálida y larga', at: cross(25, false, sunset - 150), icon: icon.sun },
    { id: 'sunset', label: 'Atardecer', note: 'Hora dorada', at: Math.max(noon, sunset - 30), icon: icon.skyAuto },
    { id: 'dusk', label: 'Anochecer', note: 'Cielo azul, luces encendidas', at: cross(-6, false, sunset + 40), icon: icon.moon },
    { id: 'evening', label: 'Noche', note: 'Ya de noche', at: Math.min(1439, sunset + 180), icon: icon.moon },
  ];
}

export function setupClockMenu(): void {
  const btn = document.getElementById('clock')!;
  const menu = document.createElement('div');
  menu.className = 'sky-menu clock-menu';
  menu.id = 'clock-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Hora de la oficina');
  document.body.append(menu);
  btn.setAttribute('aria-controls', menu.id);

  const render = () => {
    const c = chosenTime();
    const cur = (() => {
      const d = new Date(now());
      return d.getHours() * 60 + d.getMinutes();
    })();
    menu.innerHTML = `
      <button class="sky-item" type="button" role="menuitemradio" aria-checked="${c === null}" data-clock="real" tabindex="-1">
        ${icon.history(16)}
        <span class="sky-item-text"><strong>Hora real</strong><span class="meta">Sigue el reloj de verdad</span></span>
        ${c === null ? icon.tick(14) : ''}
      </button>
      ${moments()
        .map(
          (m) => `
      <button class="sky-item" type="button" role="menuitemradio" aria-checked="${c === m.at}" data-clock="${m.at}" tabindex="-1">
        ${m.icon(16)}
        <span class="sky-item-text"><strong>${esc(m.label)} <span class="num muted">${hm(m.at)}</span></strong><span class="meta">${esc(m.note)}</span></span>
        ${c === m.at ? icon.tick(14) : ''}
      </button>`,
        )
        .join('')}
      <label class="clock-slider">
        <span class="meta">Otra hora · <span class="num" data-clock-out>${hm(cur)}</span></span>
        <input type="range" min="0" max="1435" step="5" value="${cur}" data-clock-range aria-label="Hora del día" />
      </label>`;
  };

  const items = () => [...menu.querySelectorAll<HTMLElement>('[data-clock]')];
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
  const label = () => {
    const c = chosenTime();
    btn.classList.toggle('is-chosen', c !== null);
    btn.title = c === null ? 'Hora real · pulsa para cambiar la hora de la oficina' : 'Hora elegida · pulsa para volver a la hora real o cambiarla';
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(menu.hidden === true, e.detail === 0);
  });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-clock]');
    if (!b) return;
    setChosenTime(b.dataset.clock === 'real' ? null : Number(b.dataset.clock));
    toggle(false);
    btn.focus();
  });
  // Dragging the slider moves the light as you go.
  menu.addEventListener('input', (e) => {
    const r = (e.target as HTMLElement).closest<HTMLInputElement>('[data-clock-range]');
    if (!r) return;
    setChosenTime(Number(r.value));
    menu.querySelector('[data-clock-out]')!.textContent = hm(Number(r.value));
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && i >= 0) {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
    } else if (e.key === 'Tab' && !(e.target as HTMLElement).matches('[data-clock-range]')) toggle(false);
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
  document.addEventListener('clock-change', label);
  label();
}
