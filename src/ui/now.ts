/**
 * The time the page shows and lights the office by: real local time, unless you picked a time
 * of day from the clock (it then holds there, today, until you go back to the real time).
 * For checking the light, `?t=2026-06-21T21:30` starts the page's clock at that moment instead.
 */
const param = new URLSearchParams(location.search).get('t');
const fixed = param ? Date.parse(param) : NaN;
const offset = Number.isNaN(fixed) ? 0 : fixed - Date.now();
const KEY = 'oficina-3d:clock';

/** Minutes since midnight you chose, or null for the real time. */
let chosen: number | null = (() => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return localStorage.getItem(KEY) !== null && Number.isFinite(v) && v >= 0 && v < 1440 ? v : null;
  } catch {
    return null;
  }
})();

const real = (): number => Date.now() + offset;

export const now = (): number => {
  if (chosen === null) return real();
  const d = new Date(real());
  d.setHours(0, 0, 0, 0);
  return d.getTime() + chosen * 60_000;
};

export const chosenTime = (): number | null => chosen;

/** Hold the office at this time of day (minutes since midnight), or null to follow the real time. */
export function setChosenTime(minutes: number | null): void {
  chosen = minutes === null ? null : ((Math.round(minutes) % 1440) + 1440) % 1440;
  try {
    if (chosen === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(chosen));
  } catch {
    /* kept for this visit only */
  }
  document.dispatchEvent(new CustomEvent('clock-change'));
}
