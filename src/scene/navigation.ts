import { CHAIR_MODELS, chairStyle, corners, deskBySlot, DOOR_W, KINDS, layoutGeometry, layoutItems, layoutRevision, layoutRooms, onLine, toWorld, WALL_T, type ChairPack, type Item, type P } from '../sim/layout';
import type { Activity, Worker } from '../sim/types';

export const MEETING_SEATS = 6;
export const MEETING_RADIUS = 1.45;

export type Pose = 'seat' | 'stool' | 'stand';

export interface Spot {
  key: string;
  x: number;
  z: number;
  rotY: number;
  pose: Pose;
  /** Seats only: how much higher (or lower) the seat is than the classic chair's. */
  lift?: number;
}

/** Seat height of the chosen chair, relative to the classic chair the poses were made for. */
const CLASSIC_SEAT = CHAIR_MODELS[0].seatTop;
const seatLift = (pack: ChairPack) => CHAIR_MODELS.find((m) => m.id === chairStyle(pack).model)!.seatTop - CLASSIC_SEAT;

export type Point = P;

// ---------------------------------------------------------------- spots (all derived from the layout)

/** Where the chair sits, in a desk's own frame (desk faces +z). */
export const DESK_SEAT = { x: 0, z: -1.25 };
/** A visitor helping at someone's desk stands here, beside the chair. */
export const DESK_GUEST = { x: 0.8, z: -1.15 };

const unique = (kind: Item['kind']) => layoutItems().find((i) => i.kind === kind);

function itemSpot(item: Item, key: string, lx: number, lz: number, turn: number, pose: Pose): Spot {
  const p = toWorld(item, lx, lz);
  return { key, x: p.x, z: p.z, rotY: item.rot + turn, pose };
}

/** Fallback when an object is missing: stand in the middle of the first room. */
function middle(key: string): Spot {
  const r = layoutRooms()[0];
  return { key, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, rotY: 0, pose: 'stand' };
}

export function deskSeat(slot: number): Spot {
  const d = deskBySlot(slot);
  return d ? { ...itemSpot(d, `seat-${slot}`, DESK_SEAT.x, DESK_SEAT.z, 0, 'seat'), lift: seatLift('desk') } : middle(`seat-${slot}`);
}

export function deskGuest(slot: number): Spot {
  const d = deskBySlot(slot);
  return d ? itemSpot(d, `guest-${slot}`, DESK_GUEST.x, DESK_GUEST.z, -0.45, 'stand') : middle(`guest-${slot}`);
}

/** Chair positions around the meeting table, in its own frame. */
export function meetingChair(i: number): { x: number; z: number; rot: number } {
  const a = (i / MEETING_SEATS) * Math.PI * 2 + Math.PI / MEETING_SEATS;
  const x = Math.sin(a) * MEETING_RADIUS;
  const z = Math.cos(a) * MEETING_RADIUS;
  return { x, z, rot: Math.atan2(-x, -z) };
}

export function meetingSeat(i: number): Spot {
  const t = unique('meeting');
  if (!t) return middle(`meet-${i}`);
  const c = meetingChair(i % MEETING_SEATS);
  return { ...itemSpot(t, `meet-${i}`, c.x, c.z, c.rot, 'seat'), lift: seatLift('meeting') };
}

/** Coffee break: mug in hand, looking out of a window (each person picks a different one). */
export function coffeeSpot(i: number): Spot {
  const windows = layoutItems().filter((it) => it.kind === 'window');
  if (!windows.length) return middle(`coffee-${i}`);
  const w = windows[i % windows.length];
  // Several people at one window stand side by side.
  const lap = Math.floor(i / windows.length);
  const lx = lap ? (lap % 2 ? 0.55 : -0.55) * Math.ceil(lap / 2) : 0;
  return itemSpot(w, `coffee-${i}`, lx, 0.85, Math.PI, 'stand');
}

/** Where a worker should be, given what they are doing. */
export function spotFor(w: Worker, index: number, all: Worker[]): Spot {
  const a: Activity = w.activity;
  if (a === 'meeting') return meetingSeat(index);
  if (a === 'coffee') return coffeeSpot(index);
  if (a === 'pairing' && w.pairWith) {
    const partner = all.find((o) => o.id === w.pairWith);
    if (partner) return deskGuest(partner.desk);
  }
  return deskSeat(w.desk);
}

// ---------------------------------------------------------------- walkable grid

const CELL = 0.2;
/** Body radius kept clear of furniture and walls. */
const CLEARANCE = 0.22;

let gridRev = -1;
let COLS = 1;
let ROWS = 1;
let origin: P = { x: 0, z: 0 };
let blocked = new Uint8Array(1);

const cellOf = (x: number, z: number) => ({
  c: Math.min(COLS - 1, Math.max(0, Math.floor((x - origin.x) / CELL))),
  r: Math.min(ROWS - 1, Math.max(0, Math.floor((z - origin.z) / CELL))),
});
const centre = (c: number, r: number): P => ({ x: origin.x + (c + 0.5) * CELL, z: origin.z + (r + 0.5) * CELL });

function inside(poly: P[], p: P): boolean {
  // Convex quad: same side of every edge.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

function rebuildGrid(): void {
  if (gridRev === layoutRevision()) return;
  gridRev = layoutRevision();
  const { bounds, joints } = layoutGeometry();
  origin = { x: bounds.minX, z: bounds.minZ };
  COLS = Math.max(1, Math.round((bounds.maxX - bounds.minX) / CELL));
  ROWS = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / CELL));
  // Everything starts blocked; open the inside of each room (clear of its walls) and each doorway.
  blocked = new Uint8Array(COLS * ROWS).fill(1);
  const keep = WALL_T / 2 + CLEARANCE;
  const open = (x0: number, z0: number, x1: number, z1: number) => {
    const a = cellOf(x0, z0);
    const b = cellOf(x1, z1);
    for (let r = a.r; r <= b.r; r++) {
      for (let c = a.c; c <= b.c; c++) {
        const p = centre(c, r);
        if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) blocked[r * COLS + c] = 0;
      }
    }
  };
  for (const room of layoutRooms()) open(room.x0 + keep, room.z0 + keep, room.x1 - keep, room.z1 - keep);
  for (const j of joints) {
    if (j.door === null) continue;
    const a = onLine(j, j.door - DOOR_W / 2 + CLEARANCE, -keep - CELL);
    const b = onLine(j, j.door + DOOR_W / 2 - CLEARANCE, keep + CELL);
    open(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  }
  for (const item of layoutItems()) {
    const info = KINDS[item.kind];
    if (info.wall) continue;
    for (const rect of info.solid ?? [info.footprint]) {
      const grown = { ...rect, w: rect.w + CLEARANCE * 2, d: rect.d + CLEARANCE * 2 };
      const poly = corners(item, grown);
      const xs = poly.map((p) => p.x);
      const zs = poly.map((p) => p.z);
      const a = cellOf(Math.min(...xs), Math.min(...zs));
      const b = cellOf(Math.max(...xs), Math.max(...zs));
      for (let r = a.r; r <= b.r; r++) {
        for (let c = a.c; c <= b.c; c++) if (inside(poly, centre(c, r))) blocked[r * COLS + c] = 1;
      }
    }
  }
}

function lineClear(a: P, b: P): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const { c, r } = cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (blocked[r * COLS + c]) return false;
  }
  return true;
}

/** Nearest walkable cell, so seats tucked under a desk edge still connect to the floor. */
function nearestOpen(c0: number, r0: number): number {
  if (!blocked[r0 * COLS + c0]) return r0 * COLS + c0;
  for (let ring = 1; ring < 16; ring++) {
    let best = -1;
    let bestD = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS || blocked[r * COLS + c]) continue;
        const d = (c - c0) ** 2 + (r - r0) ** 2;
        if (d < bestD) {
          bestD = d;
          best = r * COLS + c;
        }
      }
    }
    if (best >= 0) return best;
  }
  return r0 * COLS + c0;
}

/** A* over the floor grid, then string-pulled into a few straight legs. */
export function route(from: P, to: Spot): Point[] {
  rebuildGrid();
  const a = cellOf(from.x, from.z);
  const b = cellOf(to.x, to.z);
  const start = nearestOpen(a.c, a.r);
  const goal = nearestOpen(b.c, b.r);

  const g = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const open: number[] = [start];
  const f = new Float32Array(COLS * ROWS).fill(Infinity);
  const h = (i: number) => Math.hypot((i % COLS) - (goal % COLS), Math.floor(i / COLS) - Math.floor(goal / COLS));
  g[start] = 0;
  f[start] = h(start);
  const closed = new Uint8Array(COLS * ROWS);
  let found = start === goal;

  while (open.length && !found) {
    // Small grid: a linear scan beats a heap here.
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cc = cur % COLS;
    const cr = Math.floor(cur / COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const n = nr * COLS + nc;
        if (blocked[n] || closed[n]) continue;
        // No corner cutting.
        if (dc && dr && (blocked[cr * COLS + nc] || blocked[nr * COLS + cc])) continue;
        const cost = g[cur] + (dc && dr ? Math.SQRT2 : 1);
        if (cost < g[n]) {
          if (g[n] === Infinity) open.push(n);
          g[n] = cost;
          f[n] = cost + h(n);
          came[n] = cur;
        }
      }
    }
  }

  const pts: Point[] = [];
  if (found) {
    const cells: number[] = [];
    for (let i = goal; i !== -1 && i !== start; i = came[i]) cells.push(i);
    cells.reverse();
    let anchor: P = { x: from.x, z: from.z };
    let prev: P | null = null;
    for (const i of cells) {
      const p = centre(i % COLS, Math.floor(i / COLS));
      if (prev && !lineClear(anchor, p)) {
        pts.push(prev);
        anchor = prev;
      }
      prev = p;
    }
    if (prev && !lineClear(anchor, to)) pts.push(prev);
  }
  pts.push({ x: to.x, z: to.z });
  // Drop points that don't move us anywhere.
  return pts.filter((p, i) => {
    const prev = i === 0 ? from : pts[i - 1];
    return Math.hypot(p.x - prev.x, p.z - prev.z) > 0.05;
  });
}
