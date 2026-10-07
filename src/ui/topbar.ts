import { ROLES } from '../sim/seed';
import { dayOf, formatClock, getState, setSpeed } from '../sim/store';
import type { Speed } from '../sim/types';
import { fill } from './dom';
import { icon } from './icons';

const SPEEDS: Speed[] = [0, 1, 4, 16];

export function kpis() {
  const s = getState();
  const today = dayOf(s.clock);
  const done = s.tasks.filter((t) => t.status === 'done');
  return {
    doneToday: done.filter((t) => t.doneAt !== null && dayOf(t.doneAt) === today).length,
    doing: s.tasks.filter((t) => t.status === 'doing').length,
    blocked: s.tasks.filter((t) => t.status === 'blocked').length,
    review: s.tasks.filter((t) => t.status === 'review').length,
    project: s.tasks.length ? (done.length / s.tasks.length) * 100 : 0,
  };
}

export function setupTopbar(): { update: () => void } {
  const speedEl = document.getElementById('speed')!;
  speedEl.innerHTML = SPEEDS.map(
    (sp) =>
      `<button type="button" role="radio" data-speed="${sp}" aria-label="${sp === 0 ? 'Pausar' : `Velocidad ${sp}×`}">${
        sp === 0 ? icon.pause(14) : `${sp}×`
      }</button>`,
  ).join('');
  speedEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-speed]');
    if (b) setSpeed(Number(b.dataset.speed) as Speed);
  });
  // Arrow keys move within the radiogroup, like a native one.
  speedEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = SPEEDS.indexOf(getState().speed);
    const next = SPEEDS[(i + (e.key === 'ArrowRight' ? 1 : SPEEDS.length - 1)) % SPEEDS.length];
    setSpeed(next);
    speedEl.querySelector<HTMLElement>(`[data-speed="${next}"]`)?.focus();
    e.preventDefault();
  });

  const kpiEl = document.getElementById('kpis')!;
  kpiEl.innerHTML = `
    <div class="kpi"><dt>Hechas hoy</dt><dd id="k-done"></dd></div>
    <div class="kpi"><dt>En curso</dt><dd id="k-doing"></dd></div>
    <div class="kpi" id="k-blocked-wrap"><dt>Bloqueadas</dt><dd id="k-blocked"></dd></div>
    <div class="kpi kpi-project"><dt>Proyecto</dt><dd><span id="k-project"></span><span class="bar bar-thin"><i id="k-project-bar"></i></span></dd></div>`;

  const legend = document.getElementById('legend')!;
  legend.innerHTML = Object.values(ROLES)
    .map((r) => `<li><span class="dot" style="--role:${r.color}"></span>${r.label}</li>`)
    .join('');

  const $ = (id: string) => document.getElementById(id)!;
  let last = '';

  return {
    update() {
      const s = getState();
      $('agency').textContent = s.agency;
      $('project').textContent = s.project;
      $('clock-day').textContent = `Día ${dayOf(s.clock)}`;
      $('clock-time').textContent = formatClock(s.clock);
      const k = kpis();
      $('k-done').textContent = String(k.doneToday);
      $('k-doing').textContent = String(k.doing);
      $('k-blocked').textContent = String(k.blocked);
      $('k-blocked-wrap').classList.toggle('is-alert', k.blocked > 0);
      $('k-project').textContent = `${Math.round(k.project)}%`;
      $('k-project-bar').style.transform = fill(k.project);
      const key = String(s.speed);
      if (key !== last) {
        last = key;
        speedEl.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
          const on = Number(b.dataset.speed) === s.speed;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        });
      }
    },
  };
}
