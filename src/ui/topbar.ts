import { ROLE_ORDER, ROLES } from '../sim/seed';
import { callMeeting, getState, setOfficeInfo, setWorking } from '../sim/store';
import { dayKey, formatClock } from '../sim/time';
import { openCalendar, nextEvent, whenLabel } from './calendar';
import { esc, fill } from './dom';
import { icon } from './icons';
import { now } from './now';

const weekday = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'short' });

export function kpis() {
  const s = getState();
  const today = dayKey(now());
  const done = s.tasks.filter((t) => t.status === 'done');
  return {
    doneToday: done.filter((t) => t.doneAt !== null && dayKey(t.doneAt) === today).length,
    doing: s.tasks.filter((t) => t.status === 'doing').length,
    blocked: s.tasks.filter((t) => t.status === 'blocked').length,
    review: s.tasks.filter((t) => t.status === 'review').length,
    project: s.tasks.length ? (done.length / s.tasks.length) * 100 : 0,
  };
}

export function setupTopbar(): { update: () => void } {
  const workEl = document.getElementById('working')!;
  workEl.addEventListener('click', () => setWorking(!getState().working));

  const kpiEl = document.getElementById('kpis')!;
  kpiEl.innerHTML = `
    <div class="kpi kpi-next"><dt>Próximo</dt><dd>
      <button class="next-btn" id="k-next" type="button" aria-label="Abrir el calendario">${icon.calendar(15)}<span class="next-when num" id="k-next-when"></span><span class="next-title" id="k-next-title"></span></button>
    </dd></div>
    <div class="kpi kpi-project"><dt>Salud</dt><dd>
      <button class="health-btn" id="k-health" type="button" aria-expanded="false" aria-controls="health-pop" aria-label="Salud del proyecto: ver el desglose">
        <span id="k-project" class="num"></span><span class="bar bar-thin"><i id="k-project-bar"></i></span>
      </button>
    </dd></div>`;

  // The breakdown: each aspect, the threshold, and a way to sit down with the head.
  const pop = document.createElement('div');
  pop.id = 'health-pop';
  pop.className = 'health-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Salud del proyecto');
  document.body.append(pop);
  const btn = document.getElementById('k-health')!;
  const place = () => {
    const r = btn.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pop.offsetWidth - 12, r.left + r.width / 2 - pop.offsetWidth / 2))}px`;
  };
  const toggle = (open: boolean) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      pop.innerHTML = healthPop();
      place();
    }
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle(pop.hidden === true);
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
  pop.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-call-meeting]')) {
      callMeeting();
      toggle(false);
    }
  });
  window.addEventListener('resize', () => {
    if (!pop.hidden) place();
  });

  document.getElementById('k-next')!.addEventListener('click', () => openCalendar(nextEvent()?.id ?? null));

  // The office's name: click it to rename it in place (Enter or leaving saves, Esc undoes).
  const nameEl = document.getElementById('agency')!;
  nameEl.addEventListener('click', () => {
    const s = getState();
    const input = document.createElement('input');
    input.className = 'brand-input';
    input.value = s.agency;
    input.placeholder = 'Mi oficina';
    input.maxLength = 60;
    input.setAttribute('aria-label', 'Nombre de la oficina');
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name !== getState().agency) setOfficeInfo(name, getState().project);
      input.replaceWith(nameEl);
      nameEl.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  });

  const legend = document.getElementById('legend')!;
  let legendFor = '';

  const $ = (id: string) => document.getElementById(id)!;

  return {
    update() {
      const s = getState();
      const t = now();
      nameEl.textContent = s.agency || 'Mi oficina';
      // Only the roles someone in the team actually has.
      const roles = ROLE_ORDER.filter((r) => s.workers.some((w) => w.role === r));
      if (roles.join() !== legendFor) {
        legendFor = roles.join();
        legend.hidden = !roles.length;
        legend.innerHTML = roles.map((r) => `<li><span class="dot" style="--role:${ROLES[r].color}"></span>${ROLES[r].label}</li>`).join('');
      }
      $('clock-day').textContent = weekday.format(t);
      $('clock-time').textContent = formatClock(t);
      const next = nextEvent();
      $('k-next-when').textContent = next ? whenLabel(next) : '';
      $('k-next-title').textContent = next ? next.title : 'Nada programado';
      $('k-next').classList.toggle('is-empty', !next);
      $('k-next').title = next ? `${whenLabel(next)} · ${next.title}` : 'Abrir el calendario';
      const h = s.health;
      // Nothing to judge before the first meeting; during it, it climbs as you talk.
      const live = s.brief.kickedOff || !!s.meeting;
      $('k-project').textContent = live ? `${h.overall}%` : '—';
      $('k-project-bar').style.transform = fill(live ? h.overall : 0);
      btn.dataset.level = live ? level(h.overall, h.threshold) : 'none';
      if (!pop.hidden) {
        const html = healthPop();
        if (pop.dataset.html !== html) {
          pop.dataset.html = html;
          pop.innerHTML = html;
        }
      }
      if (workEl.getAttribute('aria-checked') !== String(s.working)) {
        workEl.setAttribute('aria-checked', String(s.working));
        workEl.title = s.working ? 'La oficina está abierta: pulsa para mandar al equipo a casa' : 'La oficina está cerrada: pulsa para que el equipo entre a trabajar';
      }
    },
  };
}

const level = (v: number, threshold: number) => (v >= 70 ? 'good' : v >= threshold ? 'fair' : 'low');

function healthPop(): string {
  const s = getState();
  const h = s.health;
  const meeting = !!s.meeting;
  if (!s.brief.kickedOff && !meeting) {
    return `
      <h2 class="health-title">Salud del proyecto</h2>
      <p class="health-note">Se mide en cuanto les cuentes el producto en la primera reunión. Hasta entonces nadie trabaja: no saben en qué.</p>
      <button class="btn btn-primary btn-sm" type="button" data-call-meeting ${s.working && !meeting ? '' : 'disabled'}>Empezar la reunión</button>`;
  }
  return `
    <div class="health-head">
      <h2 class="health-title">Salud del proyecto</h2>
      <span class="health-total num" data-level="${level(h.overall, h.threshold)}">${h.overall}%</span>
    </div>
    <p class="health-note">${
      !s.brief.kickedOff
        ? 'Va subiendo a medida que les cuentas el producto: lo que aclaras queda apuntado en el momento.'
        : h.crisis
        ? `Por debajo del ${h.threshold} %: el trabajo está en pausa hasta hablarlo con la dirección.`
        : `Si baja del ${h.threshold} %, se pausa el trabajo y la dirección te convoca.`
    }</p>
    <ul class="health-list">${h.aspects
      .map(
        (a) => `
        <li>
          <span class="health-row"><span>${esc(a.label)}</span><span class="num">${a.value}%</span></span>
          <span class="bar bar-thin" data-level="${level(a.value, h.threshold)}"><i style="transform:scaleX(${a.value / 100})"></i></span>
          <span class="health-why">${esc(a.note)} · pesa un ${Math.round(a.weight * 100)} %</span>
        </li>`,
      )
      .join('')}</ul>
    <button class="btn btn-sm" type="button" data-call-meeting ${s.working && !meeting ? '' : 'disabled'}>${meeting ? 'Reunión en curso' : 'Convocar reunión'}</button>`;
}
