import * as THREE from 'three';
import type { CalendarEvent } from '../sim/types';
import { dayKey } from '../sim/time';

/**
 * The wall planner's face: this month, today framed, a coloured bar on each day with something
 * on it (and "+n" when there's more than one). One canvas shared by every planner in the office,
 * repainted only when the calendar or the day changes.
 */
const W = 640;
const H = 512;
let canvas: HTMLCanvasElement | null = null;
let tex: THREE.CanvasTexture | null = null;
let painted = '';

export function calendarTexture(): THREE.CanvasTexture {
  if (!tex) {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
  }
  return tex;
}

const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });

export function paintCalendar(events: readonly CalendarEvent[], now: number): void {
  calendarTexture();
  const key = `${dayKey(now)}|${events.map((e) => `${e.id}:${e.start}:${e.title}`).join(',')}`;
  if (key === painted) return;
  painted = key;
  const ctx = canvas!.getContext('2d')!;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, W, H);
  // Header: the month.
  ctx.fillStyle = '#2b2824';
  ctx.fillRect(0, 0, W, 72);
  const month = monthName.format(now);
  ctx.fillStyle = '#fbfaf6';
  ctx.font = '600 34px "IBM Plex Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(month.charAt(0).toUpperCase() + month.slice(1), 28, 38);

  const d0 = new Date(now);
  const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((lead + days) / 7);
  const top = 112;
  const cw = (W - 32) / 7;
  const ch = (H - top - 16) / rows;
  ctx.font = '500 18px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillStyle = '#8a8276';
  ctx.textAlign = 'center';
  ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach((l, i) => ctx.fillText(l, 16 + cw * i + cw / 2, 92));
  ctx.textAlign = 'left';

  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = dayKey(e.start);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const today = dayKey(now);
  for (let n = 1; n <= days; n++) {
    const i = lead + n - 1;
    const x = 16 + (i % 7) * cw;
    const y = top + Math.floor(i / 7) * ch;
    const k = dayKey(new Date(d0.getFullYear(), d0.getMonth(), n).getTime());
    ctx.strokeStyle = '#e4ddd0';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
    if (k === today) {
      ctx.strokeStyle = '#2b2824';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
    }
    ctx.fillStyle = k < today ? '#b3aa9c' : '#2b2824';
    ctx.font = '600 20px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(String(n), x + 10, y + 20);
    const plans = byDay.get(k);
    if (plans) {
      ctx.fillStyle = k < today ? '#cdbfa9' : '#c8763f';
      ctx.fillRect(x + 6, y + ch - 22, cw - 12, 14);
      if (plans.length > 1) {
        ctx.fillStyle = '#2b2824';
        ctx.font = '600 15px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillText(`+${plans.length - 1}`, x + cw - 30, y + 20);
      }
    }
  }
  tex!.needsUpdate = true;
}
