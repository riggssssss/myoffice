/**
 * The time the page shows and lights the office by: real local time. For checking the light,
 * `?t=2026-06-21T21:30` starts the page's clock at that moment instead (it keeps running).
 */
const param = new URLSearchParams(location.search).get('t');
const fixed = param ? Date.parse(param) : NaN;
const offset = Number.isNaN(fixed) ? 0 : fixed - Date.now();

export const now = (): number => Date.now() + offset;
