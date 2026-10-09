/**
 * Office layout as plain data: the rooms (rectangles that join into bigger shapes) and every
 * movable object in them. The scene builds meshes from it, navigation derives walkable floor,
 * doors and seats from it, the room editor edits it.
 */
import { DIRECTOR_SLOT } from './seed';
import { readPref, savePref } from './prefs';

/** Wall thickness and height. Walls straddle the room edges. */
export const WALL_T = 0.12;
export const WALL_H = 3.2;
const HALF = WALL_T / 2;
/** A new room is one parcel: room for six desks with walkways around them. */
export const PARCEL = 9;
export const ROOM_MIN = 3;
export const ROOM_MAX = 27;
/** Rooms snap to this grid when resized. */
export const ROOM_GRID = 0.5;
/** Doorway between two joined rooms, centred on the wall they share. */
export const DOOR_W = 1.4;
export const DOOR_H = 2.15;
/** Shared wall needed for a doorway (door plus a bit of wall each side). */
export const JOIN_MIN = DOOR_W + 0.4;

export type ItemKind =
  | 'desk'
  | 'meeting'
  | 'shelf'
  | 'sofa'
  | 'armchair'
  | 'rug'
  | 'whiteboard'
  | 'calendar'
  | 'window'
  | 'entrance'
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
  /** Radians around y. Wall objects face into their room (local +z). */
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
  /** Hangs on (or sits in) an outside wall instead of standing on the floor. */
  wall?: boolean;
  /** Wall objects: how far in front of the wall's centre line it sits. */
  inset?: number;
  /** The office needs exactly one: it can move but not be removed or copied. */
  unique?: boolean;
  /** One per agent: comes and goes with them (see syncDesks), can move but not be added or removed by hand. */
  perWorker?: boolean;
  /** Lies on the floor (a rug): furniture can stand on it and people walk over it. */
  flat?: boolean;
}

export const KINDS: Record<ItemKind, KindInfo> = {
  desk: {
    label: 'Puesto de trabajo',
    category: 'Mobiliario',
    perWorker: true,
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
  shelf: { label: 'Estantería', category: 'Mobiliario', footprint: { w: 0.45, d: 2.5 } },
  /** Nari tufted sofa (user-supplied .fbx, converted): 2.23 × 0.93 m, seat facing +z. */
  /** Wool rug, "Maze" weave (user-supplied textures). */
  rug: { label: 'Alfombra de lana', category: 'Mobiliario', footprint: { w: 2.4, d: 1.7 }, flat: true },
  sofa: { label: 'Sofá Nari', category: 'Mobiliario', footprint: { w: 2.25, d: 0.95 }, solid: [{ w: 2.25, d: 0.5, cz: -0.22 }] },
  /** The Roundish chair on its own, to place anywhere (reception, a corner to read). */
  armchair: { label: 'Butaca Roundish', category: 'Mobiliario', footprint: { w: 0.75, d: 0.75 } },
  plantLowA: { label: 'Ave del paraíso', category: 'Plantas', footprint: { w: 0.7, d: 0.7 } },
  plantLowB: { label: 'Ave del paraíso II', category: 'Plantas', footprint: { w: 0.7, d: 0.7 } },
  wickerVase: { label: 'Cesta de mimbre', category: 'Plantas', footprint: { w: 0.75, d: 0.75 } },
  bush: { label: 'Arbusto en maceta', category: 'Plantas', footprint: { w: 0.65, d: 0.65 } },
  window: { label: 'Ventana', category: 'Pared', footprint: { w: 2.2, d: 0.1 }, wall: true, inset: 0 },
  entrance: { label: 'Puerta de entrada', category: 'Pared', footprint: { w: 1.5, d: 0.1 }, wall: true, inset: 0, unique: true },
  whiteboard: { label: 'Pizarra', category: 'Pared', footprint: { w: 2.8, d: 0.1 }, wall: true, inset: HALF + 0.03 },
  /** Shows this month's plans; clicking it opens the calendar. */
  calendar: { label: 'Calendario', category: 'Pared', footprint: { w: 1.3, d: 0.1 }, wall: true, inset: HALF + 0.03 },
};

export const KIND_ORDER = Object.keys(KINDS) as ItemKind[];

/** One look for every desk in the office ("Personalizar mesas"). */
export type DeskModel = 'classic' | 'ogiM' | 'ogiY';
export type DeskTop = 'theme' | 'oak' | 'walnut' | 'smoked' | 'ebony' | 'white' | 'grey';
export type DeskFrame = 'theme' | 'black' | 'white' | 'alu';
export interface DeskStyle {
  model: DeskModel;
  top: DeskTop;
  frame: DeskFrame;
}
/** Floor finish of one room. 'plain' is the original flat floor. */
export type FloorKind =
  | 'plain'
  | 'oak'
  | 'walnut'
  | 'walnutRed'
  | 'smoked'
  | 'ebony'
  | 'herringbone'
  | 'herringboneSmoked'
  | 'tiles'
  | 'concrete'
  | 'terrazzo'
  | 'carpet';
export const FLOORS: { id: FloorKind; label: string }[] = [
  { id: 'plain', label: 'Liso (el de siempre)' },
  { id: 'oak', label: 'Tablón de nogal miel' },
  { id: 'walnut', label: 'Tablón de nogal natural' },
  { id: 'walnutRed', label: 'Tablón de nogal rojizo' },
  { id: 'smoked', label: 'Tablón de nogal ahumado' },
  { id: 'ebony', label: 'Tablón de nogal negro' },
  { id: 'herringbone', label: 'Espiga de nogal miel' },
  { id: 'herringboneSmoked', label: 'Espiga de nogal ahumado' },
  { id: 'tiles', label: 'Baldosa de piedra' },
  { id: 'concrete', label: 'Microcemento' },
  { id: 'terrazzo', label: 'Terrazo' },
  { id: 'carpet', label: 'Moqueta' },
];

/** Finish on the inside of one room's walls. 'plain' is the original cream wall. */
export type WallKind =
  | 'plain'
  | 'sage'
  | 'terracotta'
  | 'mist'
  | 'slats'
  | 'slatsDark'
  | 'panelNatural'
  | 'panelSmoked'
  | 'panelRed'
  | 'brick'
  | 'concrete'
  | 'limewash'
  | 'stripes';
export const WALLS: { id: WallKind; label: string }[] = [
  { id: 'plain', label: 'Liso (el de siempre)' },
  { id: 'sage', label: 'Pintura verde salvia' },
  { id: 'terracotta', label: 'Pintura terracota' },
  { id: 'mist', label: 'Pintura azul niebla' },
  { id: 'slats', label: 'Listones de nogal miel' },
  { id: 'slatsDark', label: 'Listones de nogal negro' },
  { id: 'panelNatural', label: 'Panel de nogal natural' },
  { id: 'panelSmoked', label: 'Panel de nogal ahumado' },
  { id: 'panelRed', label: 'Panel de nogal rojizo' },
  { id: 'brick', label: 'Ladrillo pintado' },
  { id: 'concrete', label: 'Microcemento' },
  { id: 'limewash', label: 'Pintura a la cal' },
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
  { id: 'theme', label: 'Nogal miel (la de siempre)', color: '#be9067' },
  { id: 'oak', label: 'Nogal natural', color: '#7b6042' },
  { id: 'walnut', label: 'Nogal rojizo', color: '#6a3914' },
  { id: 'smoked', label: 'Nogal ahumado', color: '#846450' },
  { id: 'ebony', label: 'Nogal negro', color: '#2b2724' },
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

/** The way in from outside: the opening it cuts, and the floor kept clear inside it. */
export const ENTRANCE = { width: 1.1, head: 2.15, clear: 1.4 };

/** Every window in the office shares one design; each one is placed on its own. */
export type WindowModel = 'slider' | 'door' | 'classic';
export interface WindowStyle {
  model: WindowModel;
  /** What the frame is made of; `frame` is its colour, from that material's own list. */
  material: WindowMaterial;
  frame: string;
}
/** Opening each model cuts in the wall (metres, from the floor). */
export const WINDOW_MODELS: { id: WindowModel; label: string; note: string; width: number; sill: number; head: number }[] = [
  { id: 'slider', label: 'Corredera', note: 'Ventana de dos hojas con antepecho', width: 2.0, sill: 0.71, head: 1.99 },
  { id: 'door', label: 'Balconera', note: 'Puerta ventana hasta el suelo', width: 2.1, sill: 0, head: 2.05 },
  { id: 'classic', label: 'Clásica', note: 'Ventana de madera de cuatro hojas con montante, alta', width: 1.26, sill: 0.5, head: 2.46 },
];
export type WindowMaterial = 'pvc' | 'lacquer' | 'wood' | 'alu' | 'steel';
/** Frame materials, each with its colours. Natural wood's ids are the veneer tones (see wood.ts). */
export const WINDOW_MATERIALS: { id: WindowMaterial; label: string; note: string; frames: { id: string; label: string; color: string }[] }[] = [
  {
    id: 'pvc',
    label: 'PVC',
    note: 'Satinado, el más habitual',
    frames: [
      { id: 'white', label: 'Blanco', color: '#efede8' },
      { id: 'cream', label: 'Crema', color: '#e4dccb' },
      { id: 'grey', label: 'Gris', color: '#8d9094' },
      { id: 'anthracite', label: 'Antracita', color: '#3a3d42' },
    ],
  },
  {
    id: 'lacquer',
    label: 'Madera lacada',
    note: 'Pintura semibrillante sobre madera',
    frames: [
      { id: 'offwhite', label: 'Blanco roto', color: '#ece6da' },
      { id: 'sage', label: 'Salvia', color: '#9aa58e' },
      { id: 'green', label: 'Verde inglés', color: '#2f4a3a' },
      { id: 'navy', label: 'Azul marino', color: '#2c3a52' },
      { id: 'black', label: 'Negro', color: '#1e1e1e' },
    ],
  },
  {
    id: 'wood',
    label: 'Madera natural',
    note: 'Veta de verdad, aceitada',
    frames: [
      { id: 'honey', label: 'Miel', color: '#c79a5e' },
      { id: 'natural', label: 'Natural', color: '#a77b4f' },
      { id: 'red', label: 'Rojiza', color: '#8d4f35' },
      { id: 'smoked', label: 'Ahumada', color: '#6e5a48' },
      { id: 'dark', label: 'Oscura', color: '#4a3326' },
    ],
  },
  {
    id: 'alu',
    label: 'Aluminio',
    note: 'Metal cepillado',
    frames: [
      { id: 'silver', label: 'Natural', color: '#b4b7ba' },
      { id: 'champagne', label: 'Champán', color: '#c9b48c' },
      { id: 'bronze', label: 'Bronce', color: '#6e5440' },
      { id: 'black', label: 'Negro', color: '#26272a' },
    ],
  },
  {
    id: 'steel',
    label: 'Acero',
    note: 'Perfil fino, aire industrial',
    frames: [
      { id: 'black', label: 'Negro', color: '#1e1e1e' },
      { id: 'graphite', label: 'Grafito', color: '#44474b' },
      { id: 'rust', label: 'Óxido', color: '#5a3b2b' },
    ],
  },
];
export const windowFrames = (m: WindowMaterial) => (WINDOW_MATERIALS.find((x) => x.id === m) ?? WINDOW_MATERIALS[0]).frames;
export const DEFAULT_WINDOW_STYLE: WindowStyle = { model: 'slider', material: 'pvc', frame: 'white' };
/** Saves from before materials had only a colour: each one becomes the material it looked like. */
const LEGACY_FRAME: Record<string, [WindowMaterial, string]> = {
  white: ['pvc', 'white'],
  anthracite: ['pvc', 'anthracite'],
  black: ['steel', 'black'],
  oak: ['wood', 'natural'],
  alu: ['alu', 'silver'],
};
export const windowModel = (id: WindowModel) => WINDOW_MODELS.find((m) => m.id === id)!;

/** Round the building: what the ground is, and what the sky is like (its light and its clouds). */
export type GroundKind = 'none' | 'grass';
export type SkyKind = 'auto' | 'clear' | 'overcast' | 'rain' | 'storm';
/** The street furniture in the garden: which bench by the path, which lamp along the pavement. */
export type BenchModel = 'maro' | 'park';
export type LampModel = 'modern' | 'lantern' | 'lantern2' | 'globes2' | 'globes3' | 'crook';
export interface OutdoorStyle {
  ground: GroundKind;
  sky: SkyKind;
  bench: BenchModel;
  lamp: LampModel;
}
export const BENCHES: { id: BenchModel; label: string; note: string }[] = [
  { id: 'maro', label: 'Piedra y madera', note: 'Laterales de piedra artificial, listones de madera' },
  { id: 'park', label: 'Parque', note: 'Hierro forjado y listones de madera' },
];
export const LAMPS: { id: LampModel; label: string; note: string }[] = [
  { id: 'modern', label: 'Moderna', note: 'Poste liso con el brazo sobre la calzada' },
  { id: 'lantern', label: 'Farol', note: 'Un farol clásico en lo alto' },
  { id: 'lantern2', label: 'Doble farol', note: 'Dos faroles colgados de volutas' },
  { id: 'globes2', label: 'Dos globos', note: 'Dos globos de cristal sobre volutas' },
  { id: 'globes3', label: 'Tres globos', note: 'Candelabro de tres globos' },
  { id: 'crook', label: 'Báculo', note: 'Poste alto curvado con la lámpara colgando' },
];
export const GROUNDS: { id: GroundKind; label: string; note: string }[] = [
  { id: 'none', label: 'Por defecto', note: 'La maqueta sola sobre la mesa' },
  { id: 'grass', label: 'Césped', note: 'Jardín con árboles, un camino hasta la puerta y la calle' },
];
export const SKIES: { id: SkyKind; label: string; note: string }[] = [
  { id: 'auto', label: 'Auto', note: 'El tiempo que hace ahora donde estás' },
  { id: 'clear', label: 'Despejado', note: 'Sol y alguna nube que pasa' },
  { id: 'overcast', label: 'Nublado', note: 'Luz suave, el sol asoma a ratos' },
  { id: 'rain', label: 'Lluvia', note: 'Suelo mojado y charcos' },
  { id: 'storm', label: 'Tormenta', note: 'Aguacero, rayos y más charcos' },
];
export const DEFAULT_OUTDOOR: OutdoorStyle = { ground: 'grass', sky: 'auto', bench: 'maro', lamp: 'modern' };

// ---------------------------------------------------------------- rooms

export interface Room {
  id: string;
  name: string;
  /** Edges on the room grid; walls are centred on them. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floor: FloorKind;
  walls: WallKind;
}

export type RoomRect = Pick<Room, 'x0' | 'z0' | 'x1' | 'z1'>;
export type Side = 'back' | 'front' | 'left' | 'right';
export const SIDES: Side[] = ['back', 'right', 'front', 'left'];

export interface P {
  x: number;
  z: number;
}

/**
 * A straight wall: along x (line z = at) or along z (line x = at), from `from` to `to`.
 * `inward` points into the room it belongs to (exterior walls only).
 */
export interface WallLine {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
}
export interface OuterWall extends WallLine {
  room: string;
  inward: P;
}
/** Wall shared by two rooms, with a doorway in the middle. */
export interface Joint extends WallLine {
  a: string;
  b: string;
  /** Doorway centre along the wall, or null when the shared stretch is too short for one. */
  door: number | null;
}

export interface RoomGeometry {
  outer: OuterWall[];
  joints: Joint[];
  /** Floor kept clear in front of each doorway, both sides. */
  doorZones: P[][];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const EPS = 1e-6;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

function sideLine(r: RoomRect, side: Side): WallLine & { inward: P } {
  switch (side) {
    case 'back':
      return { axis: 'x', at: r.z0, from: r.x0, to: r.x1, inward: { x: 0, z: 1 } };
    case 'front':
      return { axis: 'x', at: r.z1, from: r.x0, to: r.x1, inward: { x: 0, z: -1 } };
    case 'left':
      return { axis: 'z', at: r.x0, from: r.z0, to: r.z1, inward: { x: 1, z: 0 } };
    case 'right':
      return { axis: 'z', at: r.x1, from: r.z0, to: r.z1, inward: { x: -1, z: 0 } };
  }
}

/** Where two rooms touch along a side (same line, overlapping stretch), if they do. */
function touch(a: RoomRect, b: RoomRect): WallLine | null {
  if (same(a.x1, b.x0) || same(b.x1, a.x0)) {
    const from = Math.max(a.z0, b.z0);
    const to = Math.min(a.z1, b.z1);
    if (to - from > EPS) return { axis: 'z', at: same(a.x1, b.x0) ? a.x1 : a.x0, from, to };
  }
  if (same(a.z1, b.z0) || same(b.z1, a.z0)) {
    const from = Math.max(a.x0, b.x0);
    const to = Math.min(a.x1, b.x1);
    if (to - from > EPS) return { axis: 'x', at: same(a.z1, b.z0) ? a.z1 : a.z0, from, to };
  }
  return null;
}

/** Point on a wall line: `along` the wall, `across` off its centre line. */
export function onLine(l: WallLine, along: number, across = 0): P {
  return l.axis === 'x' ? { x: along, z: l.at + across } : { x: l.at + across, z: along };
}

const cache = new WeakMap<readonly Room[], RoomGeometry>();

/** Walls, doorways and bounds derived from the rooms (cached per rooms array). */
export function roomGeometry(rooms: readonly Room[]): RoomGeometry {
  let g = cache.get(rooms);
  if (g) return g;
  const joints: Joint[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const t = touch(rooms[i], rooms[j]);
      if (!t) continue;
      const door = t.to - t.from >= JOIN_MIN - EPS ? (t.from + t.to) / 2 : null;
      joints.push({ ...t, a: rooms[i].id, b: rooms[j].id, door });
    }
  }
  const outer: OuterWall[] = [];
  for (const r of rooms) {
    for (const side of SIDES) {
      const l = sideLine(r, side);
      // Cut away every stretch this side shares with a neighbour; what's left faces outside.
      const shared = joints
        .filter((j) => (j.a === r.id || j.b === r.id) && j.axis === l.axis && same(j.at, l.at))
        .sort((p, q) => p.from - q.from);
      let cur = l.from;
      for (const s of shared) {
        if (s.from - cur > EPS) outer.push({ axis: l.axis, at: l.at, from: cur, to: s.from, room: r.id, inward: l.inward });
        cur = Math.max(cur, s.to);
      }
      if (l.to - cur > EPS) outer.push({ axis: l.axis, at: l.at, from: cur, to: l.to, room: r.id, inward: l.inward });
    }
  }
  const doorZones: P[][] = [];
  for (const j of joints) {
    if (j.door === null) continue;
    const a = j.door - DOOR_W / 2;
    const b = j.door + DOOR_W / 2;
    const d = HALF + 0.4;
    doorZones.push([onLine(j, a, -d), onLine(j, b, -d), onLine(j, b, d), onLine(j, a, d)]);
  }
  const bounds = {
    minX: Math.min(...rooms.map((r) => r.x0)),
    maxX: Math.max(...rooms.map((r) => r.x1)),
    minZ: Math.min(...rooms.map((r) => r.z0)),
    maxZ: Math.max(...rooms.map((r) => r.z1)),
  };
  g = { outer, joints, doorZones, bounds };
  cache.set(rooms, g);
  return g;
}

export const roomOf = (rooms: readonly Room[], p: P) =>
  rooms.find((r) => p.x > r.x0 - EPS && p.x < r.x1 + EPS && p.z > r.z0 - EPS && p.z < r.z1 + EPS);

const overlap2 = (a: RoomRect, b: RoomRect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;

/** Why a set of rooms isn't a valid office, or null. */
export function roomsProblem(rooms: readonly Room[]): string | null {
  for (const r of rooms) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    if (w < ROOM_MIN - EPS || d < ROOM_MIN - EPS) return `Una sala mide al menos ${ROOM_MIN} × ${ROOM_MIN} m`;
    if (w > ROOM_MAX + EPS || d > ROOM_MAX + EPS) return `Una sala mide como mucho ${ROOM_MAX} m por lado`;
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (overlap2(rooms[i], rooms[j])) return 'Se metería dentro de otra sala';
    }
  }
  // Every room reachable through doorways.
  const { joints } = roomGeometry(rooms);
  const seen = new Set([rooms[0]?.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const j of joints) {
      if (j.door === null) continue;
      if (seen.has(j.a) !== seen.has(j.b)) {
        seen.add(j.a);
        seen.add(j.b);
        grew = true;
      }
    }
  }
  if (seen.size < rooms.length) return 'Cada sala tiene que compartir pared con otra (1,8 m o más, para la puerta)';
  return null;
}

/** Rect of a parcel-sized room glued to one side of `r`, aligned with its start (or end). */
export function besideRect(r: RoomRect, side: Side, alignEnd = false): RoomRect {
  const s = PARCEL;
  switch (side) {
    case 'right':
    case 'left': {
      const z0 = alignEnd ? r.z1 - s : r.z0;
      const x0 = side === 'right' ? r.x1 : r.x0 - s;
      return { x0, x1: x0 + s, z0, z1: z0 + s };
    }
    case 'front':
    case 'back': {
      const x0 = alignEnd ? r.x1 - s : r.x0;
      const z0 = side === 'front' ? r.z1 : r.z0 - s;
      return { x0, x1: x0 + s, z0, z1: z0 + s };
    }
  }
}

// ---------------------------------------------------------------- items

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

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rotFor = (n: P) => Math.atan2(n.x, n.z);
/** Wall objects keep this far from the ends of their wall. */
const WALL_END = 0.15;

/** The outside wall a wall object hangs on, if it is on one. */
export function wallOf(item: Pick<Item, 'x' | 'z' | 'rot' | 'kind'>, rooms: readonly Room[]): OuterWall | undefined {
  const inset = KINDS[item.kind].inset ?? 0;
  const nx = Math.sin(item.rot);
  const nz = Math.cos(item.rot);
  return roomGeometry(rooms).outer.find((w) => {
    if (w.inward.x * nx + w.inward.z * nz < 0.99) return false;
    const p = onLine(w, w.axis === 'x' ? item.x : item.z);
    const off = (item.x - p.x) * w.inward.x + (item.z - p.z) * w.inward.z;
    const along = w.axis === 'x' ? item.x : item.z;
    return Math.abs(off - inset) < 0.05 && along > w.from - EPS && along < w.to + EPS;
  });
}

/** Wall objects slide along the outside walls, flat against (or set into) the nearest one. */
export function snapToWall(item: Pick<Item, 'kind'>, x: number, z: number, rooms: readonly Room[]): { x: number; z: number; rot: number } | null {
  const info = KINDS[item.kind];
  const w = info.footprint.w;
  let best: { x: number; z: number; rot: number } | null = null;
  let bestD = Infinity;
  for (const wall of roomGeometry(rooms).outer) {
    if (wall.to - wall.from < w + WALL_END * 2) continue;
    const along = clamp(wall.axis === 'x' ? x : z, wall.from + w / 2 + WALL_END, wall.to - w / 2 - WALL_END);
    const p = onLine(wall, along);
    const q = { x: p.x + wall.inward.x * (info.inset ?? 0), z: p.z + wall.inward.z * (info.inset ?? 0) };
    // Prefer walls on the inside of the room the pointer is in.
    const d = Math.hypot(q.x - x, q.z - z);
    if (d < bestD) {
      bestD = d;
      best = { x: q.x, z: q.z, rot: rotFor(wall.inward) };
    }
  }
  return best;
}

const label = (kind: ItemKind) => KINDS[kind].label.toLowerCase();

/** Why an item can't stand where it is, or null if the spot is fine. `pad` asks for extra room around it. */
export function placementProblem(item: Item, items: readonly Item[], rooms: readonly Room[] = saved.rooms, pad = 0): string | null {
  const info = KINDS[item.kind];
  const f = info.footprint;
  const mine = corners(item, pad ? { ...f, w: f.w + pad * 2, d: f.d + pad * 2 } : f);
  if (info.wall) {
    const wall = wallOf(item, rooms);
    if (!wall) return 'Va en una pared exterior';
    const along = wall.axis === 'x' ? item.x : item.z;
    if (along - f.w / 2 < wall.from + WALL_END - 0.01 || along + f.w / 2 > wall.to - WALL_END + 0.01) return 'No cabe en ese tramo de pared';
    for (const other of items) {
      if (other.id === item.id || !KINDS[other.kind].wall) continue;
      if (wallOf(other, rooms) !== wall) continue;
      const o = wall.axis === 'x' ? other.x : other.z;
      if (Math.abs(o - along) < (f.w + KINDS[other.kind].footprint.w) / 2 - 0.01) return `Choca con: ${label(other.kind)}`;
    }
    return null;
  }
  // Whole footprint inside one room, clear of its walls.
  const room = roomOf(rooms, { x: item.x, z: item.z });
  const inside = (p: P) => room && p.x >= room.x0 + HALF - 0.01 && p.x <= room.x1 - HALF + 0.01 && p.z >= room.z0 + HALF - 0.01 && p.z <= room.z1 - HALF + 0.01;
  if (!room || !mine.every(inside)) return 'Se sale de la sala';
  for (const zone of roomGeometry(rooms).doorZones) if (overlaps(mine, zone)) return 'Tapa una puerta';
  for (const door of items) if (door.kind === 'entrance' && overlaps(mine, entranceZone(door))) return 'Tapa la puerta de entrada';
  for (const other of items) {
    if (other.id === item.id || KINDS[other.kind].wall) continue;
    // A rug lies under things: nothing collides with it.
    if (info.flat || KINDS[other.kind].flat) continue;
    if (overlaps(mine, corners(other, KINDS[other.kind].footprint))) return `Choca con: ${label(other.kind)}`;
  }
  return null;
}

/** Floor kept clear just inside the entrance, so people can come and go. */
export const entranceZone = (door: Pick<Item, 'x' | 'z' | 'rot'>) => corners(door, { w: ENTRANCE.width + 0.4, d: ENTRANCE.clear, cz: ENTRANCE.clear / 2 });

/** Nearest free spot to (x, z) for an item, searching outwards; null if the office is full. */
export function findFreeSpot(item: Item, items: readonly Item[], x: number, z: number, pad = 0, rooms: readonly Room[] = saved.rooms): { x: number; z: number; rot: number } | null {
  const info = KINDS[item.kind];
  const step = 0.25;
  for (let ring = 0; ring < 120; ring++) {
    const n = Math.max(1, ring * 8);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      let px = snap(x + Math.cos(a) * ring * step);
      let pz = snap(z + Math.sin(a) * ring * step);
      let rot = item.rot;
      if (info.wall) {
        const s = snapToWall(item, px, pz, rooms);
        if (!s) return null;
        ({ x: px, z: pz, rot } = s);
      }
      const probe = { ...item, x: px, z: pz, rot };
      if (!placementProblem(probe, items, rooms, pad)) return { x: px, z: pz, rot };
    }
  }
  return null;
}

export const GRID = 0.25;
export const snap = (v: number, grid = GRID) => Math.round(v / grid) * grid;

// ---------------------------------------------------------------- default office

/**
 * The team's room, a reception with the way in, then the meeting room and below it the head's
 * own office, both ending on the same right-hand side. Everything lines up front and back with the team's room.
 */
function seedRooms(): Room[] {
  const h = PARCEL / 2;
  return [
    { id: 'r1', name: 'Zona de trabajo', x0: -PARCEL, z0: -h, x1: 0, z1: h, floor: 'plain', walls: 'plain' },
    { id: 'r2', name: 'Recepción', x0: 0, z0: -h, x1: 4, z1: h, floor: 'plain', walls: 'plain' },
    { id: 'r3', name: 'Sala de reuniones', x0: 4, z0: -h, x1: 10, z1: 0.5, floor: 'plain', walls: 'plain' },
    { id: 'r4', name: 'Despacho de dirección', x0: 4, z0: 0.5, x1: 10, z1: h, floor: 'plain', walls: 'plain' },
  ];
}

/**
 * The house rule for agents' desks: two columns of three in the team room, facing the front,
 * filled from the windows forward. Spots taken or outside the rooms are skipped.
 */
const DESK_SPOTS: readonly { x: number; z: number; rot: number }[] = [-2.5, 0.5, 3.5].flatMap((z) =>
  [-6.6, -2.9].map((x) => ({ x, z, rot: 0 })),
);

/** Where the house rule puts this desk, or null when every default spot is taken. */
function defaultDeskSpot(item: Item, items: readonly Item[], rooms: readonly Room[]): { x: number; z: number; rot: number } | null {
  return DESK_SPOTS.find((s) => !placementProblem({ ...item, ...s }, items, rooms)) ?? null;
}

function seedItems(): Item[] {
  const items: Item[] = [];
  let n = 0;
  const add = (kind: ItemKind, x: number, z: number, rot = 0, extra: Partial<Item> = {}) =>
    items.push({ id: `i${++n}`, kind, x, z, rot, ...extra });
  const h = PARCEL / 2;

  // The head's desk, in their office; agents' desks follow the house rule (DESK_SPOTS).
  add('desk', 7, 2.75, Math.PI, { slot: DIRECTOR_SLOT, decor: 'books' });
  add('entrance', 2, h, Math.PI);
  add('meeting', 7, -2);
  // Reception: the sofa against the wall between the doors to the meeting room and the head's office.
  add('sofa', 3.4, 0.25, -Math.PI / 2);
  add('rug', 2.15, 0.25, Math.PI / 2);
  add('whiteboard', 7, -h + KINDS.whiteboard.inset!);
  add('calendar', CALENDAR_SPOTS[0][0], -h + KINDS.calendar.inset!);
  add('shelf', -0.35, -2.4);
  // Windows: two at the back of the team room, one on its side and front; the meeting room's side; the office's side and front.
  add('window', -6.9, -h, 0);
  add('window', -3.3, -h, 0);
  add('window', -PARCEL, 1.5, Math.PI / 2);
  add('window', -4.5, h, Math.PI);
  add('window', 10, -2, -Math.PI / 2);
  add('window', 10, 2.5, -Math.PI / 2);
  add('window', 7, h, Math.PI);
  add('plantLowA', 9.35, -3.85, 2.2);
  add('bush', 4.65, 3.85);
  add('plantLowB', 0.65, -3.85);
  add('bush', -8.35, 3.85);
  add('wickerVase', 0.65, 3.85);
  return items;
}

// ---------------------------------------------------------------- store

/**
 * v2: rooms. v3: reception and the director's office. v4: the sofa in reception. v5: its rug. v2 saves keep
 * their finishes and the desks that still fit, on the new rooms; older ones start over from the default office.
 */
const VERSION = 6;
const BACKUP_KEY = 'oficina-3d:layout:v2';

interface Saved {
  version: number;
  rooms: Room[];
  items: Item[];
  nextId: number;
  nextRoom: number;
  deskStyle: DeskStyle;
  chairs: Record<ChairPack, ChairStyle>;
  windows: WindowStyle;
  outdoor: OutdoorStyle;
}

/** What undo restores. */
export type LayoutSnapshot = Omit<Saved, 'version' | 'nextId' | 'nextRoom'>;

const defaultChairs = (): Record<ChairPack, ChairStyle> => ({
  desk: { ...CHAIR_DEFAULTS.classic },
  meeting: { ...CHAIR_DEFAULTS.classic },
});

function load(): Saved {
  try {
    const raw = readPref('layout');
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.version >= 2 && s.version <= VERSION && Array.isArray(s.items) && Array.isArray(s.rooms) && s.rooms.length) {
        s.items = s.items.filter((i) => i.kind in KINDS);
        // Saves where an old migration handed out an id already in use (a desk and the calendar
        // both «i22»: dragging the desk moved the calendar's spot along the wall): the later one gets its own.
        const seen = new Set<string>();
        for (const i of s.items) {
          if (seen.has(i.id)) i.id = newId(s);
          seen.add(i.id);
        }
        s.nextId = Math.max(s.nextId ?? 0, ...s.items.map((i) => Number(i.id.slice(1)) + 1 || 0));
        s.rooms = s.rooms.map((r) => ({
          ...r,
          floor: FLOORS.some((f) => f.id === r.floor) ? r.floor : 'plain',
          walls: WALLS.some((w) => w.id === r.walls) ? r.walls : 'plain',
        }));
        if (roomsProblem(s.rooms)) return fresh();
        s.deskStyle = { ...DEFAULT_DESK_STYLE, ...s.deskStyle };
        const chairs = defaultChairs();
        for (const pack of ['desk', 'meeting'] as const) {
          const c = s.chairs?.[pack];
          if (c && CHAIR_MODELS.some((m) => m.id === c.model)) chairs[pack] = chairStyleFor(c);
        }
        s.chairs = chairs;
        const w = s.windows;
        const material = WINDOW_MATERIALS.some((m) => m.id === w?.material) ? w.material : (LEGACY_FRAME[w?.frame]?.[0] ?? DEFAULT_WINDOW_STYLE.material);
        const frames = windowFrames(material);
        const frame = frames.some((f) => f.id === w?.frame) ? w.frame : w?.material ? frames[0].id : (LEGACY_FRAME[w?.frame]?.[1] ?? frames[0].id);
        s.windows = { model: WINDOW_MODELS.some((m) => m.id === w?.model) ? w.model : DEFAULT_WINDOW_STYLE.model, material, frame };
        const o = s.outdoor;
        s.outdoor = {
          ground: GROUNDS.some((g) => g.id === o?.ground) ? o.ground : DEFAULT_OUTDOOR.ground,
          sky: SKIES.some((k) => k.id === o?.sky) ? o.sky : DEFAULT_OUTDOOR.sky,
          bench: BENCHES.some((b) => b.id === o?.bench) ? o.bench : DEFAULT_OUTDOOR.bench,
          lamp: LAMPS.some((l) => l.id === o?.lamp) ? o.lamp : DEFAULT_OUTDOOR.lamp,
        };
        s.nextRoom ||= s.rooms.length + 1;
        if (s.version === 2) return fromV2(s, raw);
        if (s.version < 4) {
          widenOffice(s);
          addSofa(s);
        }
        if (s.version < 5) addRug(s);
        if (s.version < 6) addCalendar(s);
        s.version = VERSION;
        // Offices saved before there was a way in get one on the first wall with room for it.
        if (!s.items.some((i) => i.kind === 'entrance')) {
          const door: Item = { id: newId(s), kind: 'entrance', x: 0, z: 0, rot: 0 };
          const r = s.rooms[0];
          const spot = findFreeSpot(door, s.items, (r.x0 + r.x1) / 2, r.z1, 0, s.rooms);
          if (spot) s.items.push({ ...door, ...spot });
        }
        return s;
      }
    }
  } catch {
    /* storage unavailable or corrupt: default office */
  }
  return fresh();
}

/**
 * Saves of the default office from before the head's office reached the meeting room's right
 * side: widen it to line up, carrying its outside wall's windows along, when nothing is in the way.
 */
function widenOffice(s: Saved): void {
  const office = s.rooms.find((r) => r.name === 'Despacho de dirección');
  const meeting = s.rooms.find((r) => r.name === 'Sala de reuniones');
  if (!office || !meeting || office.x1 >= meeting.x1 || Math.abs(office.z0 - meeting.z1) > 1e-6) return;
  const oldX = office.x1;
  const rooms = s.rooms.map((r) => (r === office ? { ...r, x1: meeting.x1 } : r));
  if (roomsProblem(rooms)) return;
  const items = s.items.map((i) => (i.kind === 'window' && Math.abs(i.x - oldX) < 1e-6 && i.z > office.z0 && i.z < office.z1 ? { ...i, x: meeting.x1 } : i));
  if (items.some((i) => placementProblem(i, items, rooms))) return;
  s.rooms = rooms;
  s.items = items;
}

/** Offices from before the sofa: one goes into reception, between its two inner doors if there's room. */
function addSofa(s: Saved): void {
  if (s.items.some((i) => i.kind === 'sofa')) return;
  const reception = s.rooms.find((r) => r.name === 'Recepción');
  if (!reception) return;
  const sofa: Item = { id: newId(s), kind: 'sofa', x: reception.x1 - 0.6, z: (reception.z0 + reception.z1) / 2 + 0.25, rot: -Math.PI / 2 };
  if (!placementProblem(sofa, s.items, s.rooms)) s.items.push(sofa);
  else {
    const spot = findFreeSpot(sofa, s.items, sofa.x, sofa.z, 0, s.rooms);
    if (spot && itemRoom({ ...sofa, ...spot }, s.rooms)?.id === reception.id) s.items.push({ ...sofa, ...spot });
  }
}

/** Where the wall planner goes: the meeting room's back wall beside the whiteboard, else the team room's. */
const CALENDAR_SPOTS: [number, number][] = [
  [4.95, 0],
  [9.25, 0],
  [-1.2, 0],
];

/** Offices from before the calendar: one goes on the first free spot of the back wall. */
function addCalendar(s: Saved): void {
  if (s.items.some((i) => i.kind === 'calendar')) return;
  for (const [x, rot] of CALENDAR_SPOTS) {
    const item: Item = { id: '', kind: 'calendar', x, z: -PARCEL / 2 + KINDS.calendar.inset!, rot };
    if (!placementProblem(item, s.items, s.rooms)) {
      s.items.push({ ...item, id: newId(s) });
      return;
    }
  }
}

/**
 * A fresh item id. `nextId` is the next free number (as addItem uses it), never below what's
 * already taken, so an id is never handed out twice.
 */
function newId(s: Saved): string {
  s.nextId = Math.max(s.nextId ?? 0, ...s.items.map((i) => Number(i.id.slice(1)) + 1 || 0));
  return `i${s.nextId++}`;
}

/** Offices from before the rug: one lies in front of the reception sofa. */
function addRug(s: Saved): void {
  const sofa = s.items.find((i) => i.kind === 'sofa');
  if (!sofa || s.items.some((i) => i.kind === 'rug')) return;
  // 1.25 m in front of the sofa's centre, along the way it faces.
  const rug: Item = { id: newId(s), kind: 'rug', x: sofa.x + Math.sin(sofa.rot) * 1.25, z: sofa.z + Math.cos(sofa.rot) * 1.25, rot: sofa.rot + Math.PI };
  if (!placementProblem(rug, s.items, s.rooms)) s.items.push(rug);
}

/** The new default rooms, with the old office's finishes and every agent desk that still fits near where it was. */
function fromV2(old: Saved, raw: string): Saved {
  try {
    localStorage.setItem(BACKUP_KEY, raw);
  } catch {
    /* no room for the copy: carry on */
  }
  const next = fresh();
  next.deskStyle = old.deskStyle;
  next.chairs = old.chairs;
  next.windows = old.windows;
  for (const d of old.items) {
    if (d.kind !== 'desk' || d.slot === undefined || d.slot < 0) continue;
    const item: Item = { ...d, id: `i${next.nextId++}` };
    const spot = findFreeSpot(item, next.items, d.x, d.z, 0, next.rooms);
    if (spot && Math.hypot(spot.x - d.x, spot.z - d.z) < 1.5) next.items.push({ ...item, ...spot });
  }
  return next;
}

function fresh(): Saved {
  const items = seedItems();
  const rooms = seedRooms();
  return {
    version: VERSION,
    rooms,
    items,
    nextId: items.length + 1,
    nextRoom: rooms.length + 1,
    deskStyle: { ...DEFAULT_DESK_STYLE },
    chairs: defaultChairs(),
    windows: { ...DEFAULT_WINDOW_STYLE },
    outdoor: { ...DEFAULT_OUTDOOR },
  };
}

let saved = load();
/** Bumped on every change, so the scene can rebuild cheaply by comparing numbers. */
let revision = 1;
const listeners = new Set<() => void>();

function changed(): void {
  revision++;
  // Here and on the local server (see prefs.ts), so it's all there tomorrow.
  savePref('layout', JSON.stringify(saved));
  for (const fn of listeners) fn();
}

export const layoutItems = (): readonly Item[] => saved.items;
export const layoutRooms = (): readonly Room[] => saved.rooms;
export const layoutGeometry = () => roomGeometry(saved.rooms);
export const deskStyle = (): Readonly<DeskStyle> => saved.deskStyle;
export const windowStyle = (): Readonly<WindowStyle> => saved.windows;
export const outdoorStyle = (): Readonly<OutdoorStyle> => saved.outdoor;
export const chairStyle = (pack: ChairPack): Readonly<ChairStyle> => saved.chairs[pack];
export const layoutRevision = () => revision;
export const layoutItem = (id: string | null) => (id ? saved.items.find((i) => i.id === id) : undefined);
export const layoutRoom = (id: string | null) => (id ? saved.rooms.find((r) => r.id === id) : undefined);
export const deskBySlot = (slot: number) => saved.items.find((i) => i.kind === 'desk' && i.slot === slot);
export const entranceItem = () => saved.items.find((i) => i.kind === 'entrance');

/** The room an item belongs to: where it stands, or the room its wall faces. */
export function itemRoom(item: Item, rooms: readonly Room[] = saved.rooms): Room | undefined {
  if (!KINDS[item.kind].wall) return roomOf(rooms, item);
  return roomOf(rooms, toWorld(item, 0, 0.4));
}

export function onLayoutChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Adds an object near a point. Desks belong to an agent: pass their seat number. */
export function addItem(kind: ItemKind, near: P, slot?: number): Item | null {
  const item = kind === 'desk' ? addDesk(slot, near) : addLoose(kind, near);
  if (item) changed();
  return item;
}

function addLoose(kind: ItemKind, near: P): Item | null {
  const item: Item = { id: `i${saved.nextId++}`, kind, x: near.x, z: near.z, rot: 0 };
  // New things land in open floor (with room to walk around them), not squeezed into a gap.
  const spot = findFreeSpot(item, saved.items, near.x, near.z, 0.6) ?? findFreeSpot(item, saved.items, near.x, near.z);
  if (!spot) return null;
  Object.assign(item, spot);
  saved.items.push(item);
  return item;
}

/** A desk goes to the next default spot (DESK_SPOTS); once those are full, near `near`. */
function addDesk(slot: number | undefined, near: P): Item | null {
  const item: Item = { id: `i${saved.nextId++}`, kind: 'desk', x: near.x, z: near.z, rot: 0 };
  item.slot = slot ?? Math.max(-1, ...saved.items.filter((i) => i.kind === 'desk').map((i) => i.slot ?? -1)) + 1;
  item.decor = item.slot % 2 ? 'plant' : 'books';
  const spot =
    defaultDeskSpot(item, saved.items, saved.rooms) ??
    findFreeSpot(item, saved.items, near.x, near.z, 0.6) ??
    findFreeSpot(item, saved.items, near.x, near.z);
  if (!spot) return null;
  Object.assign(item, spot);
  saved.items.push(item);
  return item;
}

/**
 * Spots for desks inside one room, the house rule's way: columns facing the front, from the back
 * wall forward (the same offsets DESK_SPOTS uses in the team room).
 */
function roomDeskSpots(r: Room): { x: number; z: number; rot: number }[] {
  const out: { x: number; z: number; rot: number }[] = [];
  for (let z = r.z0 + 2; z < r.z1 - 0.8; z += 3) for (let x = r.x0 + 2.4; x < r.x1 - 1.2; x += 3.7) out.push({ x, z, rot: 0 });
  return out;
}

function deskSpotIn(item: Item, roomId: string): { x: number; z: number; rot: number } | null {
  const r = layoutRoom(roomId);
  if (!r) return null;
  const others = saved.items.filter((i) => i.id !== item.id);
  const spot = roomDeskSpots(r).find((s) => !placementProblem({ ...item, ...s }, others, saved.rooms));
  if (spot) return spot;
  const near = findFreeSpot(item, others, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 0.6);
  return near && itemRoom({ ...item, ...near })?.id === roomId ? near : null;
}

/** An agent's desk inside a given room (a team's), or null if it doesn't fit there. */
export function addDeskInRoom(slot: number, roomId: string): Item | null {
  if (deskBySlot(slot)) return null;
  const item: Item = { id: `i${saved.nextId}`, kind: 'desk', x: 0, z: 0, rot: 0, slot, decor: slot % 2 ? 'plant' : 'books' };
  const spot = deskSpotIn(item, roomId);
  if (!spot) return null;
  saved.nextId++;
  Object.assign(item, spot);
  saved.items.push(item);
  changed();
  return item;
}

/** Moves an agent's existing desk into a room (their team's). False if it doesn't fit. */
export function moveDeskToRoom(slot: number, roomId: string): boolean {
  const item = deskBySlot(slot);
  if (!item) return false;
  if (itemRoom(item)?.id === roomId) return true;
  const spot = deskSpotIn(item, roomId);
  if (!spot) return false;
  Object.assign(item, spot);
  changed();
  return true;
}

export function duplicateItem(id: string): Item | null {
  const src = layoutItem(id);
  if (!src || KINDS[src.kind].unique || KINDS[src.kind].perWorker) return null;
  const copy = addItem(src.kind, { x: src.x + 0.5, z: src.z + 0.5 });
  if (!copy) return null;
  if (!KINDS[src.kind].wall) copy.rot = src.rot;
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
  if (i < 0 || KINDS[saved.items[i].kind].unique || KINDS[saved.items[i].kind].perWorker) return;
  saved.items.splice(i, 1);
  changed();
}

/** Every desk changes together. */
export function setDeskStyle(patch: Partial<DeskStyle>): void {
  saved.deskStyle = { ...saved.deskStyle, ...patch };
  changed();
}

/** Every window changes together. */
export function setWindowStyle(patch: Partial<WindowStyle>): void {
  saved.windows = { ...saved.windows, ...patch };
  // Another material: its first colour, unless the one you had exists in it too.
  const frames = windowFrames(saved.windows.material);
  if (!frames.some((f) => f.id === saved.windows.frame)) saved.windows.frame = frames[0].id;
  changed();
}

/** The ground round the building and the sky over it. */
export function setOutdoor(patch: Partial<OutdoorStyle>): void {
  saved.outdoor = { ...saved.outdoor, ...patch };
  changed();
}

/** Restyle a whole pack. Switching model starts from that model's own defaults. */
export function setChairStyle(pack: ChairPack, patch: Partial<ChairStyle>): void {
  const cur = saved.chairs[pack];
  const next = patch.model && patch.model !== cur.model ? { ...CHAIR_DEFAULTS[patch.model], ...patch } : { ...cur, ...patch };
  saved.chairs = { ...saved.chairs, [pack]: chairStyleFor(next) };
  changed();
}

// ---------------------------------------------------------------- room edits

/** Rooms with one of them swapped for `next` (a new array, so derived geometry recomputes). */
const withRoom = (next: Room) => saved.rooms.map((r) => (r.id === next.id ? next : r));

/**
 * Why the office can't take these rooms, or null. Besides the rooms themselves, nothing that
 * fits now may end up outside a room, in a doorway or off its wall.
 */
export function roomChangeProblem(rooms: readonly Room[]): string | null {
  const p = roomsProblem(rooms);
  if (p) return p;
  for (const it of saved.items) {
    if (placementProblem(it, saved.items, saved.rooms)) continue;
    if (placementProblem(it, saved.items, rooms)) return `Se queda fuera o tapa una puerta: ${label(it.kind)}`;
  }
  return null;
}

export function updateRoom(id: string, patch: Partial<Omit<Room, 'id'>>): string | null {
  const r = layoutRoom(id);
  if (!r) return null;
  const next = withRoom({ ...r, ...patch });
  if ('x0' in patch || 'x1' in patch || 'z0' in patch || 'z1' in patch) {
    const problem = roomChangeProblem(next);
    if (problem) return problem;
  }
  saved.rooms = next;
  changed();
  return null;
}

/** Glue a new parcel-sized room to one side of a room. Returns it, or why it can't go there. */
export function addRoom(beside: string, side: Side): Room | string {
  const r = layoutRoom(beside);
  if (!r) return 'No hay sala';
  let last = 'No cabe ahí';
  for (const alignEnd of [false, true]) {
    const rect = besideRect(r, side, alignEnd);
    const room: Room = { ...rect, id: `r${saved.nextRoom}`, name: `Sala ${saved.nextRoom}`, floor: r.floor, walls: r.walls };
    const problem = roomChangeProblem([...saved.rooms, room]);
    if (problem) {
      last = problem;
      continue;
    }
    saved.nextRoom++;
    saved.rooms = [...saved.rooms, room];
    changed();
    return room;
  }
  return last;
}

/** Can a room go on that side (used to offer the "+" there)? */
export const canAddRoom = (beside: Room, side: Side) =>
  [false, true].some((alignEnd) => !roomsProblem([...saved.rooms, { ...beside, ...besideRect(beside, side, alignEnd), id: '_probe' }]));

/** Items that go away with a room. */
export const roomItems = (id: string) => saved.items.filter((i) => itemRoom(i)?.id === id);

/** Remove a room and what's in it. Returns why not, or null. */
export function removeRoom(id: string): string | null {
  if (saved.rooms.length < 2) return 'La oficina necesita al menos una sala';
  const rest = saved.rooms.filter((r) => r.id !== id);
  const problem = roomsProblem(rest);
  if (problem) return 'Quitarla dejaría otra sala sin conexión';
  const gone = new Set(roomItems(id).map((i) => i.id));
  saved.rooms = rest;
  saved.items = saved.items.filter((i) => !gone.has(i.id));
  changed();
  return null;
}

/** Undo: put back a snapshot taken with snapshotLayout(). */
export function restoreLayout(snap: LayoutSnapshot): void {
  const copy = structuredClone(snap);
  Object.assign(saved, copy);
  changed();
}

export const snapshotLayout = (): LayoutSnapshot =>
  structuredClone({
    rooms: saved.rooms,
    items: saved.items,
    deskStyle: saved.deskStyle,
    chairs: saved.chairs,
    windows: saved.windows,
    outdoor: saved.outdoor,
  });

/** Back to the default office; the agents' desks (by seat number) go where the house rule says. */
export function resetLayout(slots: number[] = []): void {
  saved = fresh();
  for (const slot of slots) if (slot >= 0) addDesk(slot, { x: -4.5, z: 0 });
  changed();
}

/** A desk whose agent has left goes with them. */
export function pruneDesks(slots: number[]): void {
  const wanted = new Set(slots);
  const before = saved.items.length;
  saved.items = saved.items.filter((i) => i.kind !== 'desk' || wanted.has(i.slot ?? -1));
  if (saved.items.length !== before) changed();
}

/** Seats with an agent but no desk yet: waiting for you to place it in the editor. */
export const unplacedDesks = (slots: number[]) => slots.filter((slot) => !deskBySlot(slot));
