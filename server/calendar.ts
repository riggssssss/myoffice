/**
 * The calendar's keeper: the organiser tells you what's coming, in plain words and without
 * asking the AI (free). The evening before (or when the office opens) what's on tomorrow; in
 * the morning what's on today; an hour before anything with a time, a heads-up.
 */
import { getState, headOf, notify, tellOwner } from '../src/sim/ops';
import { dayKey } from '../src/sim/time';
import type { CalendarEvent, Worker } from '../src/sim/types';

const SOON_MS = 60 * 60_000;
let lastCheck = 0;

const time = (t: number) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(t);
const when = (e: CalendarEvent) => (e.allDay ? `«${e.title}» (todo el día)` : `«${e.title}» a las ${time(e.start)}`);

/** "a, b y c". */
const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** Who keeps the calendar: the organiser, or the head when there's none in. */
function keeper(): Worker | undefined {
  const st = getState();
  const here = (w: Worker | undefined) => (w && w.enabled ? w : undefined);
  return here(st.workers.find((w) => w.role === 'organizer')) ?? here(headOf(st.workers));
}

export function calendarTick(): void {
  const st = getState();
  const now = Date.now();
  if (now - lastCheck < 20_000 || !st.working) return;
  lastCheck = now;
  const by = keeper();
  if (!by) return;
  const today = dayKey(now);
  const tomorrow = dayKey(now + 24 * 3600_000);
  const upcoming = st.events.filter((e) => e.start >= now - 12 * 3600_000);

  // The morning round: what's on today and tomorrow, in one message.
  // Anything within the hour gets its own heads-up below instead.
  const todays = upcoming.filter((e) => dayKey(e.start) === today && !e.told.includes('day') && (e.allDay || e.start - now > SOON_MS));
  const tomorrows = upcoming.filter((e) => dayKey(e.start) === tomorrow && !e.told.includes('eve'));
  if (todays.length || tomorrows.length) {
    const parts = [todays.length ? `Hoy tienes ${list(todays.map(when))}.` : '', tomorrows.length ? `Mañana tienes ${list(tomorrows.map(when))}.` : ''];
    const first = todays[0] ?? tomorrows[0];
    tellOwner(by.id, 'reminder', parts.filter(Boolean).join(' '), '', { type: 'calendar', eventId: first.id });
    for (const e of todays) e.told.push('day');
    for (const e of tomorrows) e.told.push('eve');
    notify('change');
  }

  // An hour before.
  for (const e of upcoming) {
    if (e.allDay || e.told.includes('soon') || e.start <= now || e.start - now > SOON_MS) continue;
    const mins = Math.max(1, Math.round((e.start - now) / 60_000));
    tellOwner(by.id, 'reminder', `En ${mins} min tienes «${e.title}».`, e.note, { type: 'calendar', eventId: e.id });
    e.told.push('soon');
    if (!e.told.includes('day')) e.told.push('day');
    notify('change');
  }
}
