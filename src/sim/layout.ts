/**
 * Room layout: every movable object in the office, as plain data. The scene builds meshes
 * from it, navigation derives walkable floor and seats from it, the room editor edits it.
 */

/** Floor footprint of the diorama. */
export const FLOOR = { minX: -8, maxX: 8, minZ: -5.5, maxZ: 5.5 };
/** Windows are part of the building: wall objects can't cover them. Back wall, centre x and width. */
export const WINDOWS = [-5.6, -2.4, 0.8].map((x) => ({ x, w: 2.3 }));

export type ItemKind =
  | 'desk'
  | 'meeting'
  | 'coffee'
  | 'shelf'
  | 'whiteboard'
  | 'plantTallA'
  | 'plantTallB'
  | 'plantLowA'
  | 'plantLowB'
  | 'wickerVase'
  | 'bush';

export type DeskDecor = 'plant' | 'books' | 'none';

export interface Item {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
  /** Radians around y. */
  rot: number;
  /** Desks only: the seat a worker is assigned to (Worker.desk). */
  slot?: number;
  /** Desks only: what sits next to the computer. */
  decor?: DeskDecor;
}

/** Rectangle in the item's own frame (before rotation). */
export interface Rect {
  w: number;
  d: number;
  cx?: number;
  cz?: number;
}

export type Category = 'Mobiliario' | 'Plantas' | 'Pared';

export interface KindInfo {
  label: string;
  category: Category;
  /** Space the object claims, including where people sit or stand to use it. */
  footprint: Rect;
  /** What people can't walk through. Defaults to the footprint. */
  solid?: Rect[];
  /** Hangs on a wall instead of standing on the floor. */
  wall?: boolean;
  /** The office needs exactly one: it can move but not be removed or copied. */
  unique?: boolean;
}

export const KINDS: Record<ItemKind, KindInfo> = {
  desk: {
    label: 'Puesto de trabajo',
    category: 'Mobiliario',
    footprint: { w: 2.4, d: 2.15, cz: -0.55 },
    solid: [{ w: 2.4, d: 1.0 }],
  },
  meeting: {
    label: 'Mesa de reuniones',
    category: 'Mobiliario',
    footprint: { w: 3.7, d: 3.7 },
    solid: [{ w: 1.9, d: 1.9 }],
    unique: true,
  },
  coffee: {
    label: 'Barra de café',
    category: 'Mobiliario',
    // The counter plus the queue in front of it.
    footprint: { w: 3.2, d: 2.6, cz: -0.95 },
    solid: [{ w: 3.1, d: 0.7 }],
    unique: true,
  },
  shelf: { label: 'Estantería', category: 'Mobiliario', footprint: { w: 0.45, d: 2.5 } },
  whiteboard: { label: 'Pizarra', category: 'Pared', footprint: { w: 2.8, d: 0.1 }, wall: true },
  plantTallA: { label: 'Ave del paraíso alta', category: 'Plantas', footprint: { w: 0.7, d: 0.7 } },
  plantTallB: { label: 'Ave del paraíso alta II', category: 'Plantas', footprint: { w: 0.7, d: 0.7 } },
  plantLowA: { label: 'Ave del paraíso', category: 'Plantas', footprint: { w: 0.7, d: 0.7 } },
  plantLowB: { label: 'Ave del paraíso II', category: 'Plantas', footprint: { w: 0.7, d: 0.7 } },
  wickerVase: { label: 'Cesta de mimbre', category: 'Plantas', footprint: { w: 0.75, d: 0.75 } },
  bush: { label: 'Arbusto en maceta', category: 'Plantas', footprint: { w: 0.65, d: 0.65 } },
};

export const KIND_ORDER = Object.keys(KINDS) as ItemKind[];

/** One look for every desk in the office ("Personalizar mesas"). */
export type DeskModel = 'classic' | 'ogiM' | 'ogiY';
export type DeskTop = 'theme' | 'oak' | 'walnut' | 'white' | 'grey';
export type DeskFrame = 'theme' | 'black' | 'white' | 'alu';
export interface DeskStyle {
  model: DeskModel;
  top: DeskTop;
  frame: DeskFrame;
}
/** Floor finish for the whole room. 'plain' is the original flat floor. */
export type FloorKind = 'plain' | 'oak' | 'walnut' | 'herringbone' | 'tiles' | 'concrete' | 'terrazzo' | 'carpet';
export const FLOORS: { id: FloorKind; label: string }[] = [
  { id: 'plain', label: 'Liso (el de siempre)' },
  { id: 'oak', label: 'Tablón de roble' },
  { id: 'walnut', label: 'Tablón de nogal' },
  { id: 'herringbone', label: 'Espiga' },
  { id: 'tiles', label: 'Baldosa de piedra' },
  { id: 'concrete', label: 'Microcemento' },
  { id: 'terrazzo', label: 'Terrazo' },
  { id: 'carpet', label: 'Moqueta' },
];

/** Finish on the inside of the two walls. 'plain' is the original cream wall. */
export type WallKind = 'plain' | 'sage' | 'terracotta' | 'mist' | 'slats' | 'brick' | 'concrete' | 'stripes';
export const WALLS: { id: WallKind; label: string }[] = [
  { id: 'plain', label: 'Liso (el de siempre)' },
  { id: 'sage', label: 'Pintura verde salvia' },
  { id: 'terracotta', label: 'Pintura terracota' },
  { id: 'mist', label: 'Pintura azul niebla' },
  { id: 'slats', label: 'Listones de roble' },
  { id: 'brick', label: 'Ladrillo pintado' },
  { id: 'concrete', label: 'Microcemento' },
  { id: 'stripes', label: 'Papel a rayas' },
];

/** Chairs come in two packs: every desk chair alike, every meeting chair alike. */
export type ChairModel = 'classic' | 'renya' | 'sava' | 'roundish';
export type ChairPack = 'desk' | 'meeting';
export interface ChairStyle {
  model: ChairModel;
  /** Upholstery colour id (see CHAIR_FABRICS). */
  fabric: string;
  /** Frame / base colour id; the options depend on the model (see CHAIR_FRAMES). */
  frame: string;
}

export const CHAIR_MODELS: { id: ChairModel; label: string; note: string; seatTop: number }[] = [
  { id: 'classic', label: 'Clásica', note: 'La de siempre', seatTop: 0.485 },
  { id: 'renya', label: 'Renya', note: 'Silla de oficina tapizada', seatTop: 0.533 },
  { id: 'sava', label: 'Sava', note: 'Silla de oficina con respaldo de malla y cabecero', seatTop: 0.533 },
  { id: 'roundish', label: 'Roundish', note: 'Butaca redondeada con estructura de madera', seatTop: 0.417 },
];

export const CHAIR_FABRICS: { id: string; label: string; color: string }[] = [
  { id: 'theme', label: 'Gris oscuro (la de siempre)', color: '#3c3833' },
  { id: 'navy', label: 'Azul marino', color: '#2b3a6b' },
  { id: 'graphite', label: 'Grafito', color: '#3b3b3e' },
  { id: 'stone', label: 'Gris piedra', color: '#b5b1aa' },
  { id: 'sand', label: 'Arena', color: '#d6c4a4' },
  { id: 'terracotta', label: 'Terracota', color: '#b5603e' },
  { id: 'mustard', label: 'Mostaza', color: '#c8952f' },
  { id: 'olive', label: 'Verde oliva', color: '#6b7148' },
  { id: 'sage', label: 'Verde salvia', color: '#9aab93' },
  { id: 'blush', label: 'Rosa palo', color: '#d6a7a1' },
  { id: 'burgundy', label: 'Burdeos', color: '#6d2a35' },
];

export const CHAIR_FRAMES: Record<ChairModel, { id: string; label: string; color: string }[]> = {
  classic: [
    { id: 'theme', label: 'Gris (la de siempre)', color: '#8a847a' },
    { id: 'black', label: 'Negro', color: '#1f1f1f' },
    { id: 'white', label: 'Blanco', color: '#e9e7e2' },
    { id: 'alu', label: 'Aluminio', color: '#b4b7ba' },
  ],
  renya: [
    { id: 'black', label: 'Negro', color: '#1c1c1c' },
    { id: 'grey', label: 'Gris', color: '#8b8d90' },
    { id: 'white', label: 'Blanco', color: '#e9e7e2' },
  ],
  sava: [
    { id: 'black', label: 'Negro', color: '#1c1c1c' },
    { id: 'grey', label: 'Gris', color: '#8b8d90' },
    { id: 'white', label: 'Blanco', color: '#e9e7e2' },
  ],
  roundish: [
    { id: 'walnut', label: 'Nogal', color: '#6b4a32' },
    { id: 'oak', label: 'Roble', color: '#b98b5a' },
    { id: 'black', label: 'Madera negra', color: '#262423' },
  ],
};

/** What each model looks like when first picked. */
export const CHAIR_DEFAULTS: Record<ChairModel, ChairStyle> = {
  classic: { model: 'classic', fabric: 'theme', frame: 'theme' },
  renya: { model: 'renya', fabric: 'navy', frame: 'black' },
  sava: { model: 'sava', fabric: 'navy', frame: 'black' },
  roundish: { model: 'roundish', fabric: 'sand', frame: 'walnut' },
};

/** Keep a style valid for its model (a frame from another model falls back to the default). */
export function chairStyleFor(s: ChairStyle): ChairStyle {
  const frames = CHAIR_FRAMES[s.model];
  return {
    model: s.model,
    fabric: CHAIR_FABRICS.some((f) => f.id === s.fabric) ? s.fabric : CHAIR_DEFAULTS[s.model].fabric,
    frame: frames.some((f) => f.id === s.frame) ? s.frame : CHAIR_DEFAULTS[s.model].frame,
  };
}

/** The office as it has always looked. */
export const DEFAULT_DESK_STYLE: DeskStyle = { model: 'classic', top: 'theme', frame: 'theme' };

export const DESK_MODELS: { id: DeskModel; label: string; note: string }[] = [
  { id: 'classic', label: 'Clásica', note: 'La de siempre' },
  { id: 'ogiM', label: 'Ogi M', note: 'Patas en A' },
  { id: 'ogiY', label: 'Ogi Y', note: 'Regulable en altura' },
];
export const DESK_TOPS: { id: DeskTop; label: string; color: string }[] = [
  { id: 'theme', label: 'Madera clara (la de siempre)', color: '#d3bf9f' },
  { id: 'oak', label: 'Roble natural', color: '#d2ae7c' },
  { id: 'walnut', label: 'Nogal', color: '#7b5539' },
  { id: 'white', label: 'Blanco', color: '#eeebe4' },
  { id: 'grey', label: 'Gris', color: '#8f8b84' },
];
export const DESK_FRAMES: { id: DeskFrame; label: string; color: string }[] = [
  { id: 'theme', label: 'Gris (la de siempre)', color: '#8a847a' },
  { id: 'black', label: 'Negro mate', color: '#262626' },
  { id: 'white', label: 'Blanco', color: '#e9e7e2' },
  { id: 'alu', label: 'Aluminio', color: '#b4b7ba' },
];

export const DESK_DECOR: { id: DeskDecor; label: string }[] = [
  { id: 'plant', label: 'Planta' },
  { id: 'books', label: 'Libros' },
  { id: 'none', label: 'Nada' },
];

// ---------------------------------------------------------------- geometry

export interface P {
  x: number;
  z: number;
}

/** Corners of a rect placed with an item's transform. */
export function corners(item: Pick<Item, 'x' | 'z' | 'rot'>, r: Rect): P[] {
  const c = Math.cos(item.rot);
  const s = Math.sin(item.rot);
  const hw = r.w / 2;
  const hd = r.d / 2;
  const cx = r.cx ?? 0;
  const cz = r.cz ?? 0;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => {
    const x = lx + cx;
    const z = lz + cz;
    // three.js y-rotation: x' = x cos + z sin, z' = -x sin + z cos
    return { x: item.x + x * c + z * s, z: item.z - x * s + z * c };
  });
}

/** A point in an item's local frame, in world space. */
export function toWorld(item: Pick<Item, 'x' | 'z' | 'rot'>, lx: number, lz: number): P {
  const c = Math.cos(item.rot);
  const s = Math.sin(item.rot);
  return { x: item.x + lx * c + lz * s, z: item.z - lx * s + lz * c };
}

function project(poly: P[], ax: number, az: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = p.x * ax + p.z * az;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/** Separating-axis test for two convex quads. */
export function overlaps(a: P[], b: P[], margin = 0.02): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const ax = -(q.z - p.z);
      const az = q.x - p.x;
      const len = Math.hypot(ax, az) || 1;
      const [a0, a1] = project(a, ax / len, az / len);
      const [b0, b1] = project(b, ax / len, az / len);
      if (a1 - margin <= b0 || b1 - margin <= a0) return false;
    }
  }
  return true;
}

export type Wall = 'back' | 'left';

/** Wall objects slide along the back or left wall, flat against it. */
export function snapToWall(x: number, z: number, w: number): { x: number; z: number; rot: number; wall: Wall } {
  const toBack = z - FLOOR.minZ;
  const toLeft = x - FLOOR.minX;
  if (toBack <= toLeft) {
    return { x: clamp(x, FLOOR.minX + w / 2, FLOOR.maxX - w / 2), z: FLOOR.minZ + 0.03, rot: 0, wall: 'back' };
  }
  return { x: FLOOR.minX + 0.03, z: clamp(z, FLOOR.minZ + w / 2, FLOOR.maxZ - w / 2), rot: Math.PI / 2, wall: 'left' };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Why an item can't stand where it is, or null if the spot is fine. `pad` asks for extra room around it. */
export function placementProblem(item: Item, items: Item[], pad = 0): string | null {
  const info = KINDS[item.kind];
  const f = info.footprint;
  const mine = corners(item, pad ? { ...f, w: f.w + pad * 2, d: f.d + pad * 2 } : f);
  if (info.wall) {
    const along = (p: P) => (Math.abs(item.rot) < 0.01 ? p.x : p.z);
    const lo = Math.min(...mine.map(along));
    const hi = Math.max(...mine.map(along));
    if (Math.abs(item.rot) < 0.01) {
      for (const win of WINDOWS) {
        if (hi > win.x - win.w / 2 + 0.02 && lo < win.x + win.w / 2 - 0.02) return 'Tapa una ventana';
      }
    }
    for (const other of items) {
      if (other.id === item.id || !KINDS[other.kind].wall) continue;
      if (overlaps(mine, corners(other, KINDS[other.kind].footprint))) return `Choca con: ${KINDS[other.kind].label.toLowerCase()}`;
    }
    return null;
  }
  for (const p of mine) {
    if (p.x < FLOOR.minX - 0.01 || p.x > FLOOR.maxX + 0.01 || p.z < FLOOR.minZ - 0.01 || p.z > FLOOR.maxZ + 0.01) {
      return 'Se sale de la sala';
    }
  }
  for (const other of items) {
    if (other.id === item.id || KINDS[other.kind].wall) continue;
    if (overlaps(mine, corners(other, KINDS[other.kind].footprint))) return `Choca con: ${KINDS[other.kind].label.toLowerCase()}`;
  }
  return null;
}

/** Nearest free spot to (x, z) for an item, searching outwards; null if the room is full. */
export function findFreeSpot(item: Item, items: Item[], x: number, z: number, pad = 0): { x: number; z: number; rot: number } | null {
  const info = KINDS[item.kind];
  const step = 0.25;
  for (let ring = 0; ring < 60; ring++) {
    const n = Math.max(1, ring * 8);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      let px = snap(x + Math.cos(a) * ring * step);
      let pz = snap(z + Math.sin(a) * ring * step);
      let rot = item.rot;
      if (info.wall) ({ x: px, z: pz, rot } = snapToWall(px, pz, info.footprint.w));
      const probe = { ...item, x: px, z: pz, rot };
      if (!placementProblem(probe, items, pad)) return { x: px, z: pz, rot };
    }
  }
  return null;
}

export const GRID = 0.25;
export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;

// ---------------------------------------------------------------- default room

function seedItems(): Item[] {
  const items: Item[] = [];
  let n = 0;
  const add = (kind: ItemKind, x: number, z: number, rot = 0, extra: Partial<Item> = {}) =>
    items.push({ id: `i${++n}`, kind, x, z, rot, ...extra });

  for (let i = 0; i < 6; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    add('desk', -5.2 + col * 3.2, row === 0 ? -1.1 : 1.1, row === 0 ? 0 : Math.PI, {
      slot: i,
      decor: i % 2 ? 'plant' : 'books',
    });
  }
  add('meeting', 5.6, -2.4);
  add('coffee', 5.75, 4.35);
  add('shelf', FLOOR.minX + 0.25, 0);
  add('whiteboard', 5.6, FLOOR.minZ + 0.03);
  add('plantTallA', -7.4, -4.9, 0.6);
  add('plantTallB', 7.4, -4.9, -0.5);
  add('plantLowA', -7.4, 4.9, 2.2);
  add('plantLowB', 2.7, -4.9);
  return items;
}

// ---------------------------------------------------------------- store

const STORAGE_KEY = 'oficina-3d:layout';
const VERSION = 1;

interface Saved {
  version: number;
  items: Item[];
  nextId: number;
  deskStyle: DeskStyle;
  floor: FloorKind;
  walls: WallKind;
  chairs: Record<ChairPack, ChairStyle>;
}

/** What undo restores. */
export interface LayoutSnapshot {
  items: Item[];
  deskStyle: DeskStyle;
  floor: FloorKind;
  walls: WallKind;
  chairs: Record<ChairPack, ChairStyle>;
}

const defaultChairs = (): Record<ChairPack, ChairStyle> => ({
  desk: { ...CHAIR_DEFAULTS.classic },
  meeting: { ...CHAIR_DEFAULTS.classic },
});

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.version === VERSION && Array.isArray(s.items)) {
        s.items = s.items.filter((i) => i.kind in KINDS);
        s.deskStyle = { ...DEFAULT_DESK_STYLE, ...s.deskStyle };
        if (!FLOORS.some((f) => f.id === s.floor)) s.floor = 'plain';
        if (!WALLS.some((w) => w.id === s.walls)) s.walls = 'plain';
        const chairs = defaultChairs();
        for (const pack of ['desk', 'meeting'] as const) {
          const c = s.chairs?.[pack];
          if (c && CHAIR_MODELS.some((m) => m.id === c.model)) chairs[pack] = chairStyleFor(c);
        }
        s.chairs = chairs;
        return s;
      }
    }
  } catch {
    /* storage unavailable or corrupt: default room */
  }
  return fresh();
}

function fresh(): Saved {
  const items = seedItems();
  return { version: VERSION, items, nextId: items.length + 1, deskStyle: { ...DEFAULT_DESK_STYLE }, floor: 'plain', walls: 'plain', chairs: defaultChairs() };
}

let saved = load();
/** Bumped on every change, so the scene can rebuild cheaply by comparing numbers. */
let revision = 1;
const listeners = new Set<() => void>();

function changed(): void {
  revision++;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* private mode / quota: layout lives in memory */
  }
  for (const fn of listeners) fn();
}

export const layoutItems = (): readonly Item[] => saved.items;
export const deskStyle = (): Readonly<DeskStyle> => saved.deskStyle;
export const floorKind = (): FloorKind => saved.floor;
export const wallKind = (): WallKind => saved.walls;
export const chairStyle = (pack: ChairPack): Readonly<ChairStyle> => saved.chairs[pack];
export const layoutRevision = () => revision;
export const layoutItem = (id: string | null) => (id ? saved.items.find((i) => i.id === id) : undefined);
export const deskBySlot = (slot: number) => saved.items.find((i) => i.kind === 'desk' && i.slot === slot);

export function onLayoutChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addItem(kind: ItemKind, near: P): Item | null {
  const item: Item = { id: `i${saved.nextId++}`, kind, x: near.x, z: near.z, rot: 0 };
  if (kind === 'desk') {
    item.slot = Math.max(-1, ...saved.items.filter((i) => i.kind === 'desk').map((i) => i.slot ?? -1)) + 1;
    item.decor = 'plant';
  }
  // New things land in open floor (with room to walk around them), not squeezed into a gap.
  const spot = findFreeSpot(item, saved.items, near.x, near.z, 0.6) ?? findFreeSpot(item, saved.items, near.x, near.z);
  if (!spot) return null;
  Object.assign(item, spot);
  saved.items.push(item);
  changed();
  return item;
}

export function duplicateItem(id: string): Item | null {
  const src = layoutItem(id);
  if (!src || KINDS[src.kind].unique) return null;
  const copy = addItem(src.kind, { x: src.x + 0.5, z: src.z + 0.5 });
  if (!copy) return null;
  copy.rot = src.rot;
  if (src.decor) copy.decor = src.decor;
  // Keep the copy's free spot valid with the original rotation.
  const spot = findFreeSpot(copy, saved.items, copy.x, copy.z);
  if (spot) Object.assign(copy, spot);
  changed();
  return copy;
}

export function updateItem(id: string, patch: Partial<Pick<Item, 'x' | 'z' | 'rot' | 'decor'>>): void {
  const item = layoutItem(id);
  if (!item) return;
  Object.assign(item, patch);
  changed();
}

export function removeItem(id: string): void {
  const i = saved.items.findIndex((it) => it.id === id);
  if (i < 0 || KINDS[saved.items[i].kind].unique) return;
  saved.items.splice(i, 1);
  changed();
}

/** Every desk changes together. */
export function setDeskStyle(patch: Partial<DeskStyle>): void {
  saved.deskStyle = { ...saved.deskStyle, ...patch };
  changed();
}

export function setFloor(floor: FloorKind): void {
  saved.floor = floor;
  changed();
}

/** Restyle a whole pack. Switching model starts from that model's own defaults. */
export function setChairStyle(pack: ChairPack, patch: Partial<ChairStyle>): void {
  const cur = saved.chairs[pack];
  const next = patch.model && patch.model !== cur.model ? { ...CHAIR_DEFAULTS[patch.model], ...patch } : { ...cur, ...patch };
  saved.chairs = { ...saved.chairs, [pack]: chairStyleFor(next) };
  changed();
}

export function setWalls(walls: WallKind): void {
  saved.walls = walls;
  changed();
}

/** Undo: put back a snapshot taken with snapshotLayout(). */
export function restoreLayout(snap: LayoutSnapshot): void {
  saved.items = snap.items.map((i) => ({ ...i }));
  saved.deskStyle = { ...snap.deskStyle };
  saved.floor = snap.floor;
  saved.walls = snap.walls;
  saved.chairs = { desk: { ...snap.chairs.desk }, meeting: { ...snap.chairs.meeting } };
  changed();
}

export const snapshotLayout = (): LayoutSnapshot => ({
  items: saved.items.map((i) => ({ ...i })),
  deskStyle: { ...saved.deskStyle },
  floor: saved.floor,
  walls: saved.walls,
  chairs: { desk: { ...saved.chairs.desk }, meeting: { ...saved.chairs.meeting } },
});

export function resetLayout(): void {
  saved = fresh();
  changed();
}

/** Every worker needs a desk: recreate any that went missing (e.g. after a simulation reset). */
export function ensureDesks(slots: number[]): void {
  let added = false;
  for (const slot of slots) {
    if (deskBySlot(slot)) continue;
    const item: Item = { id: `i${saved.nextId++}`, kind: 'desk', x: 0, z: 0, rot: 0, slot, decor: 'plant' };
    const spot = findFreeSpot(item, saved.items, 0, 0);
    if (spot) Object.assign(item, spot);
    saved.items.push(item);
    added = true;
  }
  if (added) changed();
}
