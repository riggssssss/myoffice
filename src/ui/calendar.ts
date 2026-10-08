import { addEvent, deleteEvent, getState, subscribe, updateEvent, worker } from '../sim/store';
import { dayKey } from '../sim/time';
import type { CalendarEvent } from '../sim/types';
import { esc } from './dom';
import { icon } from './icons';
import { now } from './now';

/**
 * The office calendar: a month to look at, the chosen day's plans, and a way to add your own.
 * The organiser reads it to remind you (the day before, that morning and an hour before).
 */

const DAY_MS = 24 * 3600_000;
const hm = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const longDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });
const dateShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

const endOfDay = (t: number) => new Date(new Date(t).setHours(23, 59, 59, 999)).getTime();

/** The next thing on the calendar that hasn't passed (all-day ones last the whole day). */
export function nextEvent(): CalendarEvent | null {
  const t = now();
  return getState().events.find((e) => (e.allDay ? endOfDay(e.start) : e.start) >= t) ?? null;
}

/** "Hoy 10:00", "Mañana", "vie 9:30", "12 nov". */
export function whenLabel(e: CalendarEvent): string {
  const t = now();
  const time = e.allDay ? '' : ` ${hm.format(e.start)}`;
  const key = dayKey(e.start);
  if (key === dayKey(t)) return `Hoy${time}`;
  if (key === dayKey(t + DAY_MS)) return `Mañana${time}`;
  if (e.start - t < 6 * DAY_MS) return `${shortDay.format(e.start)}${time}`;
  return `${dateShort.format(e.start)}${time}`;
}

const dialog = () => document.getElementById('calendar-dialog') as HTMLDialogElement;

let month = new Date(); // any day in the month on show
let selected = dayKey(Date.now());
let editing: string | null = null;

const at = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function grid(): string {
  const s = getState();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  // Weeks start on Monday.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const today = dayKey(now());
  const busy = new Map<string, number>();
  for (const e of s.events) busy.set(dayKey(e.start), (busy.get(dayKey(e.start)) ?? 0) + 1);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(d.getTime());
    const n = busy.get(key) ?? 0;
    cells.push(`
      <button type="button" class="cal-day${d.getMonth() !== month.getMonth() ? ' is-out' : ''}${key === today ? ' is-today' : ''}${key === selected ? ' is-selected' : ''}"
        data-cal-pick="${key}" aria-pressed="${key === selected}" aria-label="${esc(longDay.format(d))}${n ? `, ${n} ${n === 1 ? 'cosa' : 'cosas'}` : ''}">
        <span class="num">${d.getDate()}</span>${n ? `<i class="cal-dot" aria-hidden="true"></i>` : ''}
      </button>`);
  }
  return `
    <div class="cal-head">
      <button class="btn btn-icon" type="button" data-cal-month="-1" aria-label="Mes anterior">${icon.prev(16)}</button>
      <h3 class="cal-month">${esc(monthName.format(month))}</h3>
      <button class="btn btn-icon" type="button" data-cal-month="1" aria-label="Mes siguiente">${icon.next(16)}</button>
    </div>
    <div class="cal-grid" role="group" aria-label="${esc(monthName.format(month))}">
      ${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span class="cal-wd" aria-hidden="true">${d}</span>`).join('')}
      ${cells.join('')}
    </div>`;
}

function dayList(): string {
  const items = getState().events.filter((e) => dayKey(e.start) === selected);
  return `
    <h3 class="cal-title">${esc(longDay.format(at(selected)))}</h3>
    ${
      items.length
        ? `<ul class="cal-list">${items
            .map((e) => {
              const by = e.by === 'owner' ? 'Lo apuntaste tú' : `Lo apuntó ${worker(e.by)?.name ?? 'un agente'}`;
              return `
              <li class="cal-item${editing === e.id ? ' is-editing' : ''}">
                <span class="cal-when num">${e.allDay ? 'Todo el día' : hm.format(e.start)}</span>
                <span class="cal-main">
                  <span class="cal-name">${esc(e.title)}</span>
                  ${e.note ? `<span class="meta">${esc(e.note)}</span>` : ''}
                  <span class="meta">${by}</span>
                </span>
                <button class="btn btn-icon btn-sm" type="button" data-cal-edit="${e.id}" aria-label="Editar ${esc(e.title)}">${icon.edit(14)}</button>
                <button class="btn btn-icon btn-sm btn-danger-text" type="button" data-cal-del="${e.id}" aria-label="Quitar ${esc(e.title)}">${icon.trash(14)}</button>
              </li>`;
            })
            .join('')}</ul>`
        : '<p class="section-note">Nada programado este día.</p>'
    }`;
}

function form(): string {
  const e = editing ? getState().events.find((x) => x.id === editing) : null;
  return `
    <form class="cal-form" data-cal-form novalidate>
      <h3 class="cal-title">${e ? 'Cambiar' : 'Añadir este día'}</h3>
      <div class="field">
        <label for="cal-title">Qué</label>
        <input id="cal-title" name="title" maxlength="120" required value="${esc(e?.title ?? '')}" placeholder="Ej. Llamada con el proveedor" autocomplete="off" />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="cal-date">Día</label>
          <input id="cal-date" name="date" type="date" value="${e ? dayKey(e.start) : selected}" required />
        </div>
        <div class="field">
          <label for="cal-time">Hora <span class="muted">(vacía: todo el día)</span></label>
          <input id="cal-time" name="time" type="time" value="${e && !e.allDay ? hm.format(e.start) : ''}" />
        </div>
      </div>
      <div class="field">
        <label for="cal-note">Nota <span class="muted">(opcional)</span></label>
        <input id="cal-note" name="note" maxlength="500" value="${esc(e?.note ?? '')}" autocomplete="off" />
      </div>
      <p class="field-error" id="cal-error" role="alert" hidden></p>
      <div class="cal-form-foot">
        ${e ? '<button class="btn btn-ghost" type="button" data-cal-cancel>Cancelar</button>' : ''}
        <button class="btn btn-primary" type="submit">${e ? 'Guardar' : `${icon.plus(15)}Añadir`}</button>
      </div>
    </form>`;
}

function render(full: boolean): void {
  const d = dialog();
  if (full) {
    d.innerHTML = `
      <div class="dialog-form cal">
        <header class="dialog-head">
          <h2 id="calendar-title">Calendario</h2>
          <button class="btn btn-icon" type="button" data-close aria-label="Cerrar">${icon.close(16)}</button>
        </header>
        <p class="section-note">${esc(keeperName())} te avisa de lo que hay: el día antes, esa mañana y una hora antes de lo que tenga hora.</p>
        <div class="cal-body">
          <div class="cal-month-box" data-cal-grid>${grid()}</div>
          <div class="cal-side">
            <div data-cal-day>${dayList()}</div>
            <div data-cal-form-box>${form()}</div>
          </div>
        </div>
      </div>`;
    return;
  }
  // Live updates leave the form alone (you may be typing).
  d.querySelector('[data-cal-grid]')!.innerHTML = grid();
  d.querySelector('[data-cal-day]')!.innerHTML = dayList();
}

const keeperName = () => getState().workers.find((w) => w.role === 'organizer')?.name ?? 'Organización';

export function openCalendar(eventId: string | null = null): void {
  const e = eventId ? getState().events.find((x) => x.id === eventId) : null;
  const t = e?.start ?? now();
  selected = dayKey(t);
  month = new Date(t);
  editing = null;
  render(true);
  const d = dialog();
  if (!d.open) d.showModal();
}

function refreshForm(): void {
  dialog().querySelector('[data-cal-form-box]')!.innerHTML = form();
}

/** Once: buttons, the form, and live updates while it's open. */
export function bindCalendar(): void {
  const d = dialog();
  d.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t === d || t.closest('[data-close]')) return d.close();
    const pick = t.closest<HTMLElement>('[data-cal-pick]');
    if (pick) {
      selected = pick.dataset.calPick!;
      const day = at(selected);
      if (day.getMonth() !== month.getMonth()) month = day;
      editing = null;
      render(false);
      refreshForm();
      d.querySelector<HTMLElement>(`[data-cal-pick="${selected}"]`)?.focus();
      return;
    }
    const mv = t.closest<HTMLElement>('[data-cal-month]');
    if (mv) {
      month = new Date(month.getFullYear(), month.getMonth() + Number(mv.dataset.calMonth), 1);
      return render(false);
    }
    const ed = t.closest<HTMLElement>('[data-cal-edit]');
    if (ed) {
      editing = ed.dataset.calEdit!;
      render(false);
      refreshForm();
      d.querySelector<HTMLInputElement>('#cal-title')?.focus();
      return;
    }
    const del = t.closest<HTMLElement>('[data-cal-del]');
    if (del) {
      if (editing === del.dataset.calDel) editing = null;
      deleteEvent(del.dataset.calDel!);
      return refreshForm();
    }
    if (t.closest('[data-cal-cancel]')) {
      editing = null;
      render(false);
      refreshForm();
    }
  });
  d.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target as HTMLFormElement;
    const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
    const fail = (msg: string) => {
      const el = f.querySelector<HTMLElement>('#cal-error')!;
      el.textContent = msg;
      el.hidden = false;
    };
    if (!v('title')) return fail('Ponle un nombre.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v('date'))) return fail('Elige el día.');
    const time = v('time');
    const start = new Date(`${v('date')}T${time || '09:00'}:00`).getTime();
    if (!Number.isFinite(start)) return fail('Esa fecha no es válida.');
    const input = { title: v('title'), start, allDay: !time, note: v('note') };
    if (editing) updateEvent(editing, input);
    else addEvent(input);
    editing = null;
    selected = v('date');
    month = at(selected);
    refreshForm();
  });
  subscribe(() => {
    if (d.open) render(false);
  });
}
