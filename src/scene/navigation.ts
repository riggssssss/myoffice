import { CHAIR_MODELS, chairStyle, corners, deskBySlot, DOOR_W, ENTRANCE, entranceItem, KINDS, layoutGeometry, layoutItems, layoutRevision, layoutRooms, onLine, toWorld, WALL_T, wallOf, type ChairPack, type Item, type P } from '../sim/layout';
import { DIRECTOR_SLOT, MEETING_SEATS } from '../sim/seed';
import type { Activity, Worker } from '../sim/types';

export { MEETING_SEATS };
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

// ---------------------------------------------------------------- outside

/** How far the walkable ground reaches beyond the building (people walk off into the distance). */
/** How far past the building people can walk (they come from and go off this far). */
const OUTSIDE = 15;

/** Just inside and just outside the way in, both facing into the office. */
export function entranceSpots(): { inside: Spot; outside: Spot } | null {
  const door = entranceItem();
  if (!door) return null;
  return {
    inside: itemSpot(door, 'door-in', 0, 0.75, 0, 'stand'),
    outside: itemSpot(door, 'door-out', 0, -1.1, 0, 'stand'),
  };
}

/** Where people sit on a sofa, in its own frame (seat faces +z), and how high the cushion is. */
const SOFA_SEATS = [-0.33, 0.33];
const SOFA_SEAT_Z = 0.2;
const SOFA_SEAT_TOP = 0.47;

/**
 * Reception: where a newcomer waits (the `i`th one). On the sofa while there's a free place,
 * then side by side just inside the door.
 */
export function receptionSpot(i: number): Spot | null {
  const door = entranceItem();
  if (!door) return null;
  const sofa = unique('sofa');
  if (sofa && i < SOFA_SEATS.length) {
    return { ...itemSpot(sofa, `sofa-${i}`, SOFA_SEATS[i], SOFA_SEAT_Z, 0, 'seat'), lift: SOFA_SEAT_TOP - CLASSIC_SEAT };
  }
  const k = sofa ? i - SOFA_SEATS.length : i;
  return itemSpot(door, `wait-${k}`, ((k % 3) - 1) * 0.8, 1.7 + Math.floor(k / 3) * 0.7, 0, 'stand');
}

/** Where the interviewer meets a newcomer in reception: face to face, just inside the door. */
export function greetSpots(): { guest: Spot; host: Spot } | null {
  const door = entranceItem();
  if (!door) return null;
  return {
    guest: itemSpot(door, 'greet-guest', 0.45, 1.5, -Math.PI / 2, 'stand'),
    host: itemSpot(door, 'greet-host', -0.45, 1.5, Math.PI / 2, 'stand'),
  };
}

/**
 * Each person's own way home: out of the door and off in their own direction, fanned out
 * across the ground in front of the entrance (`k` of `n`).
 */
export function exitSpot(k: number, n: number): Spot | null {
  const door = entranceItem();
  if (!door) return null;
  const spread = Math.min(160, 28 * Math.max(1, n - 1)) * (Math.PI / 180);
  // Alternate sides: the 1st goes right, the 2nd left, the 3rd further right…
  const side = k % 2 ? -1 : 1;
  const step = Math.ceil(k / 2);
  const slots = Math.max(1, Math.ceil((n - 1) / 2));
  const a = n > 1 ? side * (step / slots) * (spread / 2) : 0;
  // Local −z is outside: out along their direction to the pavement (7–9 m), on their way.
  const dist = 6.6 + (k % 3) * 0.9;
  return itemSpot(door, `exit-${k}`, Math.sin(a) * dist, -1.1 - Math.cos(a) * dist, Math.PI, 'stand');
}

/** Stops for someone going round the team: beside each desk in use, or the team room's middle. */
export function roamStops(slots: number[]): Spot[] {
  const stops = slots.filter((s) => deskBySlot(s)).map((s) => deskGuest(s));
  if (stops.length) return stops;
  const r = layoutRooms()[0];
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  return [
    { key: 'roam-a', x: cx - 1.5, z: cz, rotY: Math.PI / 2, pose: 'stand' },
    { key: 'roam-b', x: cx + 1.5, z: cz + 1, rotY: -Math.PI / 2, pose: 'stand' },
  ];
}

/** True if a point is out on the ground rather than on an office floor. */
export function isOutside(p: P): boolean {
  return !layoutRooms().some((r) => p.x > r.x0 - WALL_T / 2 && p.x < r.x1 + WALL_T / 2 && p.z > r.z0 - WALL_T / 2 && p.z < r.z1 + WALL_T / 2);
}

/** A loop round the building, a little way out from its walls. */
export function patrolSpots(): Spot[] {
  const b = layoutGeometry().bounds;
  const m = 1.1;
  const x0 = b.minX - m;
  const x1 = b.maxX + m;
  const z0 = b.minZ - m;
  const z1 = b.maxZ + m;
  const pts: [number, number][] = [
    [x0, z0],
    [(x0 + x1) / 2, z0],
    [x1, z0],
    [x1, (z0 + z1) / 2],
    [x1, z1],
    [(x0 + x1) / 2, z1],
    [x0, z1],
    [x0, (z0 + z1) / 2],
  ];
  // Looking in at the office from each stop: that's what there is to criticise.
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return pts.map(([x, z], i) => ({ key: `patrol-${i}`, x, z, rotY: Math.atan2(cx - x, cz - z), pose: 'stand' }));
}

/** Fixed chairs at the meeting table. */
const SEAT = { head: 0, guest: 2, interviewer: 3, talk: 4 };

/** Where a worker should be, given what they are doing. */
export function spotFor(w: Worker, index: number, all: Worker[]): Spot {
  const a: Activity = w.activity;
  const office = deskBySlot(DIRECTOR_SLOT);
  // Meeting with you: round the table, the head at its head, the rest in chart order.
  if (a === 'meeting') {
    const table = all.filter((o) => o.activity === 'meeting').sort((p, q) => Number(q.role === 'director') - Number(p.role === 'director'));
    return meetingSeat(Math.max(0, table.indexOf(w)));
  }
  if (a === 'visiting') return office ? deskGuest(DIRECTOR_SLOT) : meetingSeat(SEAT.head + 1);
  if (a === 'interview') return meetingSeat(SEAT.guest);
  if (a === 'interviewing' || w.role === 'interviewer') return meetingSeat(SEAT.interviewer);
  // Talking: whoever started it goes over to the other, who stays put.
  if (a === 'talking' && w.talk && !w.talk.host) {
    const host = all.find((o) => o.id === w.talk!.with);
    if (host?.role === 'director') return office ? deskGuest(DIRECTOR_SLOT) : meetingSeat(SEAT.head + 1);
    if (host && deskBySlot(host.desk)) return deskGuest(host.desk);
    return meetingSeat(SEAT.talk);
  }
  if (a === 'talking' && w.talk?.host && !deskBySlot(w.desk) && w.role !== 'director') return meetingSeat(SEAT.talk + 1);
  if (w.role === 'director') return office ? deskSeat(DIRECTOR_SLOT) : meetingSeat(SEAT.head);
  if (a === 'coffee') return coffeeSpot(index);
  if (a === 'pairing' && w.pairWith) {
    const partner = all.find((o) => o.id === w.pairWith);
    if (partner) return deskGuest(partner.desk);
  }
  if (deskBySlot(w.desk)) return deskSeat(w.desk);
  // No desk yet: wait in reception until you place it.
  const waiting = all.filter((o) => !deskBySlot(o.desk) && o.role !== 'director' && !['organizer', 'interviewer', 'skeptic'].includes(o.role));
  return receptionSpot(Math.max(0, waiting.indexOf(w))) ?? middle(`wait-${w.id}`);
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
  // The grid reaches out past the walls: people come in from outside, and the sceptic walks round.
  origin = { x: bounds.minX - OUTSIDE, z: bounds.minZ - OUTSIDE };
  COLS = Math.max(1, Math.round((bounds.maxX - bounds.minX + OUTSIDE * 2) / CELL));
  ROWS = Math.max(1, Math.round((bounds.maxZ - bounds.minZ + OUTSIDE * 2) / CELL));
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
  // Outside: all the ground clear of the building's walls.
  const rooms = layoutRooms();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = centre(c, r);
      if (!rooms.some((rm) => p.x > rm.x0 - keep && p.x < rm.x1 + keep && p.z > rm.z0 - keep && p.z < rm.z1 + keep)) blocked[r * COLS + c] = 0;
    }
  }
  // The way in: a passage through the wall at the entrance.
  const door = entranceItem();
  const wall = door && wallOf(door, rooms);
  if (door && wall) {
    const along = wall.axis === 'x' ? door.x : door.z;
    const a = onLine(wall, along - ENTRANCE.width / 2 + CLEARANCE, -keep - CELL);
    const b = onLine(wall, along + ENTRANCE.width / 2 - CLEARANCE, keep + CELL);
    open(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  }
  for (const j of joints) {
    if (j.door === null) continue;
    const a = onLine(j, j.door - DOOR_W / 2 + CLEARANCE, -keep - CELL);
    const b = onLine(j, j.door + DOOR_W / 2 - CLEARANCE, keep + CELL);
    open(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
  }
  for (const item of layoutItems()) {
    const info = KINDS[item.kind];
    if (info.wall || info.flat) continue;
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
