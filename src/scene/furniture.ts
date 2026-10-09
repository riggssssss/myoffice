import * as THREE from 'three';
import { calendarTexture } from './calendarBoard';
import { grainSheen, woodFinish, type WoodTone } from './wood';
import { ROLES, ROLE_ORDER } from '../sim/seed';
import { CHAIR_DEFAULTS, CHAIR_FABRICS, CHAIR_FRAMES, ENTRANCE, WALL_T, windowFrames, windowModel, type ChairPack, type ChairStyle, type DeskStyle, type Item, type WindowStyle } from '../sim/layout';
import { placeComputer } from './computer';
import { DESK_SEAT, MEETING_SEATS, meetingChair } from './navigation';
import { texture, type ScenePalette } from './palette';
import { contactShadow } from './textures';
import { placePlant, type ChairKind, type DecorKind, type DeskKind, type LampKind, type PlantKind, type SofaKind, type WindowKind } from './plants';

/** Models that arrive after start-up; until then each object shows a simple stand-in. */
export interface Assets {
  computer: THREE.Object3D | null;
  desks: Map<DeskKind, THREE.Object3D> | null;
  chairs: Map<ChairKind, THREE.Object3D> | null;
  plants: Map<PlantKind, THREE.Object3D> | null;
  decor: Map<DecorKind, THREE.Object3D> | null;
  windows: Map<WindowKind, THREE.Object3D> | null;
  sofas: Map<SofaKind, THREE.Object3D> | null;
  lamps: Map<LampKind, THREE.Object3D> | null;
}

export type MatFn = (slot: keyof ScenePalette, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;

export interface Built {
  obj: THREE.Group;
  /** Desks: the screen, lit by whoever works there. */
  screen?: THREE.MeshStandardMaterial;
  /** Entrance: the leaf's hinge; turning it (negative y) swings the door into the room. */
  door?: THREE.Object3D;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Flat colored material that does not follow the theme (role accents), one per colour. */
const accents = new Map<string, THREE.MeshStandardMaterial>();
function accent(color: string): THREE.MeshStandardMaterial {
  let mat = accents.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    mat.userData.shared = true;
    accents.set(color, mat);
  }
  return mat;
}

// ---------------------------------------------------------------- reading lamps

/**
 * The desk lamps' light is painted, not computed: a glowing bulb and warm pools on the desk
 * and the floor round it. A real light per desk made every surface in the office pay for every
 * lamp, lit or not, and adding a desk recompiled every material.
 */
let lampMats: { bulb: THREE.MeshStandardMaterial; shade: THREE.MeshStandardMaterial; desk: THREE.MeshBasicMaterial; floor: THREE.MeshBasicMaterial } | null = null;
let lampGlow = 0;
let poolTex: THREE.CanvasTexture | null = null;

function poolTexture(): THREE.CanvasTexture {
  if (poolTex) return poolTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  // Falls off like light from a bulb: bright under it, a long soft tail, black at the rim.
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [t, a] of [[0, 1], [0.2, 0.72], [0.45, 0.32], [0.7, 0.1], [1, 0]] as const) g.addColorStop(t, `rgba(255,255,255,${a})`);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  poolTex = new THREE.CanvasTexture(c);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

function lampMaterials() {
  if (lampMats) return lampMats;
  const pool = (opacity: number) =>
    new THREE.MeshBasicMaterial({
      map: poolTexture(),
      color: '#ffc98a',
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  lampMats = {
    bulb: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd7a0', emissiveIntensity: 0, roughness: 0.3 }),
    // Opal glass: milky white by day, glowing warm from inside at night.
    shade: new THREE.MeshStandardMaterial({ color: '#f4f1ea', emissive: '#ffcf96', emissiveIntensity: 0, roughness: 0.35, transparent: true, opacity: 0.92 }),
    desk: pool(0),
    floor: pool(0),
  };
  for (const m of Object.values(lampMats)) m.userData.shared = true;
  setLampGlow(lampGlow);
  return lampMats;
}

/** How bright the reading lamps are, 0 (off) to 1 (full). */
export function setLampGlow(k: number): void {
  lampGlow = k;
  if (!lampMats) return;
  lampMats.bulb.emissiveIntensity = 3 * k;
  lampMats.shade.emissiveIntensity = 1.5 * k;
  lampMats.desk.opacity = 0.65 * k;
  lampMats.floor.opacity = 0.3 * k;
  // Off by day: the pools aren't drawn at all.
  lampMats.desk.visible = lampMats.floor.visible = k > 0.002;
}

/** A flat pool of lamplight over x0..x1 × z0..z1 at height y, brightest at (cx, cz), fading out by `r`. */
function lightPool(x0: number, x1: number, z0: number, z1: number, y: number, cx: number, cz: number, r: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + (pos.getX(i) - cx) / (2 * r), 0.5 + (pos.getZ(i) - cz) / (2 * r));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  return mesh;
}

/** Simple low-poly pot + crown, shown until the plant models load. */
function placeholderPlant(m: MatFn, height: number): THREE.Group {
  const g = new THREE.Group();
  const s = height / 1.25;
  g.scale.setScalar(s);
  g.add(cyl(0.22, 0.17, 0.4, m('pot'), 0, 0.2, 0, 14));
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), m('plant'));
  leaves.position.y = 0.72;
  leaves.scale.set(1, 1.25, 1);
  leaves.castShadow = true;
  g.add(leaves);
  return g;
}

/** Leafy desk plant (user model), or the stand-in. */
function deskPlant(m: MatFn, assets: Assets, height: number): THREE.Object3D {
  const t = assets.decor?.get('DeskPlant');
  return t ? placePlant(t, m, height) : placeholderPlant(m, height);
}

const PLANT_HEIGHT: Record<string, number> = {
  plantLowA: 1.35,
  plantLowB: 1.25,
  wickerVase: 0.72,
  bush: 1.0,
};
const PLANT_MODEL: Record<string, PlantKind> = {
  plantLowA: 'PlantLowA',
  plantLowB: 'PlantLowB',
};
const DECOR_MODEL: Record<string, DecorKind> = { wickerVase: 'WickerVase', bush: 'BushPlant' };

// ---------------------------------------------------------------- desk finishes

const finishes = new Map<string, THREE.MeshStandardMaterial>();

/** Shared material for one finish; 'theme' finishes come from the palette so they follow day/night. */
function finish(key: string, make: () => THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  let mat = finishes.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial(make());
    if (mat.map && (key.startsWith('top:') || key.startsWith('window:frame:wood'))) grainSheen(mat);
    mat.userData.shared = true;
    finishes.set(key, mat);
  }
  return mat;
}

function topMaterial(style: DeskStyle, m: MatFn): THREE.Material {
  switch (style.top) {
    case 'theme':
      return m('wood');
    case 'oak':
      return finish('top:oak', () => woodFinish('natural'));
    case 'walnut':
      return finish('top:walnut', () => woodFinish('red'));
    case 'smoked':
      return finish('top:smoked', () => woodFinish('smoked'));
    case 'ebony':
      return finish('top:ebony', () => woodFinish('dark'));
    case 'white':
      return finish('top:white', () => ({ color: '#eeebe4', roughness: 0.55 }));
    case 'grey':
      return finish('top:grey', () => ({ color: '#8f8b84', roughness: 0.7 }));
  }
}

function frameMaterial(style: DeskStyle, m: MatFn): THREE.Material {
  switch (style.frame) {
    case 'theme':
      return m('metal');
    case 'black':
      return finish('frame:black', () => ({ color: '#262626', roughness: 0.55, metalness: 0.3 }));
    case 'white':
      return finish('frame:white', () => ({ color: '#e9e7e2', roughness: 0.5, metalness: 0.1 }));
    case 'alu':
      return finish('frame:alu', () => ({ color: '#b4b7ba', roughness: 0.35, metalness: 0.6 }));
  }
}

/** Ogi models are 2.0 × 0.8 m with the top at 0.74; stretch them to the room's 2.4 × 1.0 desks, top at 0.77. */
const OGI_SCALE = new THREE.Vector3(2.4 / 2.0, 0.77 / 0.74, 1.0 / 0.8);

function placeOgi(template: THREE.Object3D, style: DeskStyle, m: MatFn): THREE.Object3D {
  const desk = template.clone(true);
  const top = topMaterial(style, m);
  const frame = frameMaterial(style, m);
  // The small aluminium parts (beam, brackets) follow the frame unless it is the default grey.
  const alu = style.frame === 'theme' ? finish('frame:alu', () => ({ color: '#b4b7ba', roughness: 0.35, metalness: 0.6 })) : frame;
  desk.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = (o.material as THREE.Material).name;
    o.material = name === 'oak' ? top : name === 'alu' ? alu : frame;
  });
  desk.position.set(0, 0, 0);
  desk.scale.copy(OGI_SCALE);
  return desk;
}

// ---------------------------------------------------------------- chairs

const CHAIR_NODE: Record<Exclude<ChairStyle['model'], 'classic'>, ChairKind> = { renya: 'Renya', sava: 'Sava', roundish: 'Roundish' };

function fabricMaterial(c: ChairStyle, m: MatFn): THREE.Material {
  if (c.fabric === 'theme') return m('chair');
  const color = CHAIR_FABRICS.find((f) => f.id === c.fabric)!.color;
  return finish(`fabric:${c.fabric}`, () => ({ color, roughness: 0.95, side: THREE.DoubleSide }));
}

function chairFrame(c: ChairStyle, m: MatFn): THREE.Material {
  if (c.frame === 'theme') return m('metal');
  const color = CHAIR_FRAMES[c.model].find((f) => f.id === c.frame)!.color;
  const wood = c.model === 'roundish';
  return finish(`chairframe:${c.model}:${c.frame}`, () => ({
    color,
    roughness: wood ? 0.6 : 0.5,
    metalness: wood ? 0 : 0.15,
    side: THREE.DoubleSide,
  }));
}

/**
 * One chair of a pack, facing +z, centred on its seat, standing on y = 0.
 * The classic chair is the original block chair (bigger at desks, lighter at the table).
 */
export function placeChair(c: ChairStyle, pack: ChairPack, m: MatFn, assets: Assets): THREE.Group {
  const g = new THREE.Group();
  const fabric = fabricMaterial(c, m);
  const frame = chairFrame(c, m);
  const template = c.model === 'classic' ? undefined : assets.chairs?.get(CHAIR_NODE[c.model]);
  if (template) {
    const chair = template.clone(true);
    // Mesh back of the Sava: a shade off the frame so it reads as a separate material.
    const mesh = c.model === 'sava' ? finish(`chairmesh:${c.frame}`, () => ({
      color: new THREE.Color(CHAIR_FRAMES.sava.find((f) => f.id === c.frame)!.color).multiplyScalar(c.frame === 'white' ? 0.85 : 1.6),
      roughness: 0.9,
      side: THREE.DoubleSide,
    })) : frame;
    const steel = finish('chair:steel', () => ({ color: '#9a9ca0', roughness: 0.35, metalness: 0.6 }));
    chair.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const name = (o.material as THREE.Material).name;
      o.material = name === 'fabric' ? fabric : name === 'mesh' ? mesh : name === 'metal' ? steel : frame;
    });
    chair.position.set(0, 0, 0);
    g.add(chair);
    return g;
  }
  if (pack === 'desk') {
    g.add(box(0.52, 0.07, 0.5, fabric, 0, 0.45, 0));
    g.add(box(0.52, 0.5, 0.06, fabric, 0, 0.76, -0.25));
    g.add(cyl(0.03, 0.03, 0.4, frame, 0, 0.22, 0, 8));
    g.add(cyl(0.24, 0.24, 0.03, frame, 0, 0.02, 0, 16));
  } else {
    g.add(box(0.42, 0.06, 0.42, fabric, 0, 0.45, 0));
    g.add(box(0.42, 0.42, 0.05, fabric, 0, 0.72, -0.21));
    g.add(cyl(0.03, 0.03, 0.4, frame, 0, 0.22, 0, 8));
  }
  return g;
}

export interface RoomLook {
  desk: DeskStyle;
  chairs: Record<ChairPack, ChairStyle>;
  windows: WindowStyle;
}

export function buildItem(item: Item, m: MatFn, assets: Assets, look: RoomLook): Built {
  const style = look.desk;
  const g = new THREE.Group();
  const out: Built = { obj: g };
  switch (item.kind) {
    case 'desk':
      buildDesk(g, item, m, assets, out, style, look.chairs.desk);
      break;
    case 'meeting':
      buildMeeting(g, m, assets, look.chairs.meeting);
      break;
    case 'window':
      buildWindow(g, assets, look.windows);
      break;
    case 'entrance':
      out.door = buildEntrance(g, m);
      break;
    case 'shelf':
      buildShelf(g, m);
      g.add(contactShadow(0.45, 2.45, 'box', 0.35));
      break;
    case 'rug':
      buildRug(g);
      break;
    case 'armchair': {
      // Same upholstery and wood as the meeting chairs when those are Roundish too; otherwise its own.
      const meeting = look.chairs.meeting;
      g.add(placeChair(meeting.model === 'roundish' ? meeting : CHAIR_DEFAULTS.roundish, 'meeting', m, assets));
      g.add(contactShadow(0.7, 0.7, 'disc', 0.35));
      break;
    }
    case 'sofa': {
      const model = assets.sofas?.get('Nari');
      g.add(model ? model.clone(true) : placeholderSofa(m));
      g.add(contactShadow(2.15, 0.9, 'box', 0.4));
      break;
    }
    case 'whiteboard':
      buildWhiteboard(g, m);
      break;
    case 'calendar':
      buildCalendar(g, m);
      break;
    default: {
      const height = PLANT_HEIGHT[item.kind];
      const model = PLANT_MODEL[item.kind] ? assets.plants?.get(PLANT_MODEL[item.kind]) : assets.decor?.get(DECOR_MODEL[item.kind]);
      g.add(model ? placePlant(model, m, height) : placeholderPlant(m, Math.min(height, 1.3)));
      g.add(contactShadow(0.45, 0.45, 'disc', 0.35));
    }
  }
  return out;
}

/**
 * Wool rug from its own weave textures (colour and height), with a bound edge. Shared
 * materials, so every rug costs one draw of each.
 */
let rugMats: { top: THREE.MeshStandardMaterial; edge: THREE.MeshStandardMaterial } | null = null;
function buildRug(g: THREE.Group): void {
  if (!rugMats) {
    const color = texture('rug-color.jpg');
    const height = texture('rug-height.jpg', false);
    for (const t of [color, height]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2.4, 1.7);
    }
    const edgeMap = texture('rug-edge.jpg');
    edgeMap.wrapS = edgeMap.wrapT = THREE.RepeatWrapping;
    edgeMap.repeat.set(12, 1);
    rugMats = {
      top: new THREE.MeshStandardMaterial({ map: color, bumpMap: height, bumpScale: 1.2, roughness: 1 }),
      edge: new THREE.MeshStandardMaterial({ map: edgeMap, roughness: 0.95 }),
    };
    rugMats.top.userData.shared = rugMats.edge.userData.shared = true;
  }
  const w = 2.4;
  const d = 1.7;
  const rim = 0.035;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w - rim * 2, 0.012, d - rim * 2), rugMats.top);
  top.position.y = 0.008;
  top.receiveShadow = true;
  g.add(top);
  // The binding: four strips round the edge, a hair higher than the pile.
  for (const [sw, sd, x, z] of [
    [w, rim, 0, (d - rim) / 2],
    [w, rim, 0, -(d - rim) / 2],
    [rim, d - rim * 2, (w - rim) / 2, 0],
    [rim, d - rim * 2, -(w - rim) / 2, 0],
  ] as const) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.016, sd), rugMats.edge);
    strip.position.set(x, 0.009, z);
    strip.receiveShadow = true;
    g.add(strip);
  }
}

/** Until the model arrives: a low block sofa of the same size. */
function placeholderSofa(m: MatFn): THREE.Group {
  const g = new THREE.Group();
  const fabric = m('wicker');
  g.add(box(2.2, 0.48, 0.92, fabric, 0, 0.24, 0));
  g.add(box(2.2, 0.36, 0.22, fabric, 0, 0.66, -0.35));
  for (const side of [-1, 1]) g.add(box(0.24, 0.3, 0.92, fabric, side * 0.98, 0.63, 0));
  return g;
}

/**
 * The way in: a frame in the wall, a wooden leaf hinged on its left that swings into the
 * room, and a mat outside on the ground. Local +z faces into the room.
 */
function buildEntrance(g: THREE.Group, m: MatFn): THREE.Object3D {
  const w = ENTRANCE.width;
  const h = ENTRANCE.head;
  const frame = m('woodDark');
  const jamb = 0.07;
  for (const side of [-1, 1]) g.add(box(jamb, h + jamb, WALL_T + 0.04, frame, side * (w / 2 + jamb / 2), (h + jamb) / 2, 0));
  g.add(box(w + jamb * 2, jamb, WALL_T + 0.04, frame, 0, h + jamb / 2, 0));

  const hinge = new THREE.Group();
  hinge.position.set(-w / 2, 0, WALL_T / 2 - 0.03);
  const leafW = w - 0.02;
  const leaf = box(leafW, h - 0.03, 0.045, m('wood'), leafW / 2, (h - 0.03) / 2 + 0.01, 0);
  hinge.add(leaf);
  // Two raised panels and a handle on each face.
  for (const [y, ph] of [[0.62, 0.9], [1.58, 0.72]] as const) {
    for (const face of [-1, 1]) hinge.add(box(leafW - 0.26, ph, 0.012, frame, leafW / 2, y, face * 0.028));
  }
  for (const face of [-1, 1]) hinge.add(box(0.04, 0.16, 0.04, m('metal'), leafW - 0.1, 1.02, face * 0.05));
  g.add(hinge);

  // Doormat on the ground outside (the ground is the slab's underside level).
  const mat = box(w + 0.1, 0.012, 0.6, m('rug'), 0, -WALL_T + 0.006, -0.42);
  mat.castShadow = false;
  g.add(mat);
  return hinge;
}

/** The desk alone (classic, or an Ogi once loaded), top at 0.77. */
export function deskObject(style: DeskStyle, m: MatFn, assets: Assets): THREE.Object3D {
  const model = style.model === 'ogiM' ? 'OgiM' : style.model === 'ogiY' ? 'OgiY' : null;
  const template = model ? assets.desks?.get(model) : undefined;
  if (template) return placeOgi(template, style, m);
  // Classic desk (also the stand-in while the Ogi models load).
  const g = new THREE.Group();
  g.add(box(2.4, 0.06, 1.0, topMaterial(style, m), 0, 0.74, 0));
  for (const [lx, lz] of [
    [-1.1, -0.42],
    [1.1, -0.42],
    [-1.1, 0.42],
    [1.1, 0.42],
  ]) {
    g.add(box(0.05, 0.71, 0.05, frameMaterial(style, m), lx, 0.355, lz));
  }
  return g;
}

function buildDesk(g: THREE.Group, item: Item, m: MatFn, assets: Assets, out: Built, style: DeskStyle, chairStyle: ChairStyle): void {
  g.add(deskObject(style, m, assets));

  // Screen material: the scene lights it in the colour of whoever works here.
  const screen = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.4, emissive: '#000' });
  out.screen = screen;
  if (assets.computer) {
    g.add(placeComputer(assets.computer, screen, 0.77));
  } else {
    // Stand-in monitor, keyboard and mouse. Faces the seat (local -z).
    g.add(box(0.08, 0.3, 0.08, m('metal'), 0, 0.92, 0.3));
    g.add(box(0.95, 0.58, 0.05, m('monitor'), 0, 1.2, 0.3));
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.49), screen);
    screenMesh.position.set(0, 1.2, 0.27);
    screenMesh.rotation.y = Math.PI;
    g.add(screenMesh);
    g.add(box(0.55, 0.025, 0.18, m('chair'), 0, 0.785, -0.2));
    g.add(box(0.1, 0.02, 0.14, m('chair'), 0.42, 0.78, -0.22));
  }

  // Lamp and its light (only lit at night): a bulb under the shade, a pool on the desk top
  // and a wider, fainter one on the floor round the desk (the desk hides the part under it).
  const lamp = lampMaterials();
  const model = assets.lamps?.get('Jwda');
  if (model) {
    // The Menu JWDA: its globe glows at night, the dimmer turned towards whoever sits here.
    const jwda = model.clone(true);
    const brass = finish('lamp:brass', () => ({ color: '#b08a4e', roughness: 0.35, metalness: 0.85 }));
    const stone = finish('lamp:stone', () => ({ color: '#8f8a82', roughness: 0.82, metalness: 0 }));
    const felt = finish('lamp:felt', () => ({ color: '#2b2824', roughness: 1, metalness: 0 }));
    jwda.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const name = (o.material as THREE.Material).name;
      o.material = name === 'shade' ? lamp.shade : name === 'bulb' ? lamp.bulb : name === 'body' ? stone : name === 'felt' ? felt : brass;
      o.castShadow = name !== 'shade' && name !== 'bulb';
    });
    jwda.position.set(-0.95, 0.77, 0.22);
    jwda.rotation.y = Math.PI;
    g.add(jwda);
  } else {
    g.add(cyl(0.09, 0.11, 0.03, m('metal'), -0.95, 0.785, 0.25));
    g.add(box(0.025, 0.36, 0.025, m('metal'), -0.95, 0.97, 0.25));
    g.add(cyl(0.05, 0.13, 0.12, m('metal'), -0.95, 1.16, 0.18));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), lamp.bulb);
    bulb.position.set(-0.95, 1.095, 0.18);
    g.add(bulb);
  }
  g.add(lightPool(-1.2, 0.3, -0.5, 0.5, 0.775, -0.95, 0.18, 0.95, lamp.desk));
  g.add(lightPool(-2.9, 1.0, -1.8, 2.1, 0.006, -0.95, 0.1, 1.9, lamp.floor));

  // Contact shade under the desk top and the chair.
  g.add(contactShadow(2.3, 0.92, 'box', 0.3));
  g.add(contactShadow(0.62, 0.62, 'disc', 0.3).translateX(DESK_SEAT.x).translateZ(DESK_SEAT.z));

  if (item.decor === 'books') {
    const books = [ROLES.research.color, ROLES.organizer.color, ROLES.dev.color];
    books.forEach((c, k) => g.add(box(0.32, 0.05, 0.24, accent(c), 0.85, 0.795 + k * 0.05, 0.22)));
  } else if (item.decor === 'plant') {
    g.add(cyl(0.05, 0.045, 0.1, accent(ROLES.design.color), 0.7, 0.82, -0.05, 12));
    const plant = deskPlant(m, assets, 0.28);
    plant.position.set(0.95, 0.77, 0.25);
    g.add(plant);
  }

  // The worker's chair (no spare seat: a visitor stands beside it).
  const chair = placeChair(chairStyle, 'desk', m, assets);
  chair.position.set(DESK_SEAT.x, 0, DESK_SEAT.z);
  g.add(chair);
}

function buildMeeting(g: THREE.Group, m: MatFn, assets: Assets, chairStyle: ChairStyle): void {
  const rug = cyl(2.3, 2.3, 0.02, m('rug'), 0, 0.01, 0, 48);
  rug.castShadow = false;
  g.add(rug);
  g.add(contactShadow(1.7, 1.7, 'disc', 0.3, 0.026));
  g.add(cyl(0.95, 0.95, 0.06, m('wood'), 0, 0.74, 0, 40));
  g.add(cyl(0.08, 0.12, 0.7, m('metal'), 0, 0.36, 0, 12));
  g.add(cyl(0.4, 0.4, 0.03, m('metal'), 0, 0.02, 0, 24));
  for (let i = 0; i < MEETING_SEATS; i++) {
    const s = meetingChair(i);
    const chair = placeChair(chairStyle, 'meeting', m, assets);
    chair.position.set(s.x, 0, s.z);
    chair.rotation.y = s.rot;
    g.add(chair);
    g.add(contactShadow(0.5, 0.5, 'disc', 0.28, 0.026).translateX(s.x).translateZ(s.z));
  }
}

function buildShelf(g: THREE.Group, m: MatFn): void {
  g.add(box(0.4, 1.9, 0.06, m('woodDark'), 0, 0.95, -1.2));
  g.add(box(0.4, 1.9, 0.06, m('woodDark'), 0, 0.95, 1.2));
  for (const y of [0.04, 0.65, 1.25, 1.86]) g.add(box(0.4, 0.05, 2.4, m('woodDark'), 0, y, 0));
  const colors = ROLE_ORDER.map((r) => ROLES[r].color);
  for (const [row, y] of [0.07, 0.68, 1.28].entries()) {
    let z = -1.08;
    let k = row;
    while (z < 1.0) {
      const thick = 0.07 + ((k * 37) % 5) * 0.015;
      const h = 0.38 + ((k * 13) % 4) * 0.04;
      g.add(box(0.28, h, thick, accent(colors[k % colors.length]), 0, y + h / 2, z + thick / 2));
      z += thick + 0.015 + (k % 4 === 3 ? 0.18 : 0);
      k++;
    }
  }
}

/** The team's kanban: sticky notes in role colours. Hangs with its face toward local +z. */
function buildWhiteboard(g: THREE.Group, m: MatFn): void {
  g.add(box(2.8, 1.3, 0.05, m('board'), 0, 1.6, 0));
  const step = 2.3 / (ROLE_ORDER.length - 1);
  ROLE_ORDER.forEach((role, col) => {
    for (let k = 0; k < 2 + (col % 2); k++) {
      const note = box(0.22, 0.22, 0.02, accent(ROLES[role].color), -1.15 + col * step, 2.0 - k * 0.3, 0.03);
      note.castShadow = false;
      g.add(note);
    }
  });
}

/** A wall planner: a thin wooden frame round this month's page (see calendarBoard.ts). Clicking it opens the calendar. */
function buildCalendar(g: THREE.Group, m: MatFn): void {
  g.add(box(1.24, 0.98, 0.04, m('woodDark'), 0, 1.55, 0));
  const page = new THREE.Mesh(
    new THREE.PlaneGeometry(1.16, 0.928),
    finish('calendar:page', () => ({ map: calendarTexture(), roughness: 0.85 })),
  );
  page.position.set(0, 1.55, 0.022);
  page.userData.calendar = true;
  g.add(page);
}

// ---------------------------------------------------------------- windows

const glass = () =>
  finish('window:glass', () => ({ color: '#cfe3ee', emissive: '#ffd8a6', emissiveIntensity: 0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));

/**
 * The rooms' light seen through the glass from outside, 0–1 (the puddles' mirror sees the
 * windows from outside; from where we look in, the glass stays clear).
 */
export function setWindowGlow(k: number): void {
  glass().emissiveIntensity = 4.5 * k;
}

/** The frame, by material: satin PVC, glossy lacquer, oiled wood with its grain, brushed aluminium, steel. */
function windowFrame(style: WindowStyle): THREE.MeshStandardMaterial {
  const color = (windowFrames(style.material).find((f) => f.id === style.frame) ?? windowFrames(style.material)[0]).color;
  return finish(`window:frame:${style.material}:${style.frame}`, () => {
    switch (style.material) {
      case 'wood':
        return { ...woodFinish(style.frame as WoodTone), roughness: 0.55 };
      case 'lacquer':
        return { color, roughness: 0.26, metalness: 0 };
      case 'alu':
        return { color, roughness: 0.32, metalness: 0.75 };
      case 'steel':
        return { color, roughness: 0.48, metalness: 0.6 };
      default:
        return { color, roughness: 0.55, metalness: 0 };
    }
  });
}

/**
 * A window set into an outside wall (the wall cuts the hole). Every window shares one design:
 * the user's slider or door window, or a simple frame while the models load.
 */
export function buildWindow(g: THREE.Group, assets: Assets, style: WindowStyle): void {
  const frame = windowFrame(style);
  const template = assets.windows?.get(style.model === 'door' ? 'DoorWindow' : style.model === 'classic' ? 'Classic' : 'Window');
  if (template) {
    const win = template.clone(true);
    const handle = finish('window:handle', () => ({ color: '#b9bcc0', roughness: 0.3, metalness: 0.7 }));
    win.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const name = (o.material as THREE.Material).name;
      o.material = name === 'glass' ? glass() : name === 'handle' ? handle : frame;
      o.castShadow = name !== 'glass';
    });
    win.position.set(0, 0, 0);
    g.add(win);
    return;
  }
  const w = windowModel(style.model);
  const h = w.head - w.sill;
  const t = 0.06;
  g.add(box(w.width, t, 0.09, frame, 0, w.sill + t / 2, 0));
  g.add(box(w.width, t, 0.09, frame, 0, w.head - t / 2, 0));
  g.add(box(t, h, 0.09, frame, -w.width / 2 + t / 2, w.sill + h / 2, 0));
  g.add(box(t, h, 0.09, frame, w.width / 2 - t / 2, w.sill + h / 2, 0));
  g.add(box(t, h, 0.07, frame, 0, w.sill + h / 2, 0));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w.width - t * 2, h - t * 2), glass());
  pane.position.set(0, w.sill + h / 2, 0);
  g.add(pane);
}
