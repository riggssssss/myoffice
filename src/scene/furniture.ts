import * as THREE from 'three';
import { ROLES, ROLE_ORDER } from '../sim/seed';
import { CHAIR_FABRICS, CHAIR_FRAMES, type ChairPack, type ChairStyle, type DeskStyle, type Item } from '../sim/layout';
import { placeComputer } from './computer';
import { DESK_SEAT, MEETING_SEATS, meetingChair } from './navigation';
import type { ScenePalette } from './palette';
import { placePlant, type ChairKind, type DecorKind, type DeskKind, type PlantKind } from './plants';

/** Models that arrive after start-up; until then each object shows a simple stand-in. */
export interface Assets {
  computer: THREE.Object3D | null;
  desks: Map<DeskKind, THREE.Object3D> | null;
  chairs: Map<ChairKind, THREE.Object3D> | null;
  plants: Map<PlantKind, THREE.Object3D> | null;
  decor: Map<DecorKind, THREE.Object3D> | null;
}

export type MatFn = (slot: keyof ScenePalette, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;

export interface Built {
  obj: THREE.Group;
  /** Desks: the screen, lit by whoever works there. */
  screen?: THREE.MeshStandardMaterial;
  /** Desks: the reading lamp, on at night. */
  lamp?: THREE.PointLight;
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

/** Flat colored material that does not follow the theme (role accents). */
const accent = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

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
  plantTallA: 1.9,
  plantTallB: 2.0,
  plantLowA: 1.35,
  plantLowB: 1.25,
  wickerVase: 0.72,
  bush: 1.0,
};
const PLANT_MODEL: Record<string, PlantKind> = {
  plantTallA: 'PlantTallA',
  plantTallB: 'PlantTallB',
  plantLowA: 'PlantLowA',
  plantLowB: 'PlantLowB',
};
const DECOR_MODEL: Record<string, DecorKind> = { wickerVase: 'WickerVase', bush: 'BushPlant' };

// ---------------------------------------------------------------- desk finishes

const finishes = new Map<string, THREE.MeshStandardMaterial>();
let oakMap: THREE.Texture | null = null;
function oak(): THREE.Texture {
  if (!oakMap) {
    oakMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}models/oak.jpg`);
    oakMap.colorSpace = THREE.SRGBColorSpace;
    oakMap.anisotropy = 4;
  }
  return oakMap;
}

/** Shared material for one finish; 'theme' finishes come from the palette so they follow day/night. */
function finish(key: string, make: () => THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  let mat = finishes.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial(make());
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
      return finish('top:oak', () => ({ map: oak(), roughness: 0.62 }));
    case 'walnut':
      // Same grain, darker stain.
      return finish('top:walnut', () => ({ map: oak(), color: '#8c6448', roughness: 0.6 }));
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
function placeChair(c: ChairStyle, pack: ChairPack, m: MatFn, assets: Assets): THREE.Group {
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
    case 'coffee':
      buildCoffee(g, m, assets);
      break;
    case 'shelf':
      buildShelf(g, m);
      break;
    case 'whiteboard':
      buildWhiteboard(g, m);
      break;
    default: {
      const height = PLANT_HEIGHT[item.kind];
      const model = PLANT_MODEL[item.kind] ? assets.plants?.get(PLANT_MODEL[item.kind]) : assets.decor?.get(DECOR_MODEL[item.kind]);
      g.add(model ? placePlant(model, m, height) : placeholderPlant(m, Math.min(height, 1.3)));
    }
  }
  return out;
}

function buildDesk(g: THREE.Group, item: Item, m: MatFn, assets: Assets, out: Built, style: DeskStyle, chairStyle: ChairStyle): void {
  const model = style.model === 'ogiM' ? 'OgiM' : style.model === 'ogiY' ? 'OgiY' : null;
  const template = model ? assets.desks?.get(model) : undefined;
  if (template) {
    g.add(placeOgi(template, style, m));
  } else {
    // Classic desk (also the stand-in while the Ogi models load).
    g.add(box(2.4, 0.06, 1.0, topMaterial(style, m), 0, 0.74, 0));
    for (const [lx, lz] of [
      [-1.1, -0.42],
      [1.1, -0.42],
      [-1.1, 0.42],
      [1.1, 0.42],
    ]) {
      g.add(box(0.05, 0.71, 0.05, frameMaterial(style, m), lx, 0.355, lz));
    }
  }

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

  // Lamp + its light (only lit at night).
  g.add(cyl(0.09, 0.11, 0.03, m('metal'), -0.95, 0.785, 0.25));
  g.add(box(0.025, 0.36, 0.025, m('metal'), -0.95, 0.97, 0.25));
  g.add(cyl(0.05, 0.13, 0.12, m('metal'), -0.95, 1.16, 0.18));
  const lamp = new THREE.PointLight('#ffc98a', 0, 3.2, 1.6);
  lamp.position.set(-0.95, 1.08, 0.1);
  g.add(lamp);
  out.lamp = lamp;

  if (item.decor === 'books') {
    const books = [ROLES.research.color, ROLES.pm.color, ROLES.backend.color];
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
  g.add(cyl(0.95, 0.95, 0.06, m('wood'), 0, 0.74, 0, 40));
  g.add(cyl(0.08, 0.12, 0.7, m('metal'), 0, 0.36, 0, 12));
  g.add(cyl(0.4, 0.4, 0.03, m('metal'), 0, 0.02, 0, 24));
  for (let i = 0; i < MEETING_SEATS; i++) {
    const s = meetingChair(i);
    const chair = placeChair(chairStyle, 'meeting', m, assets);
    chair.position.set(s.x, 0, s.z);
    chair.rotation.y = s.rot;
    g.add(chair);
  }
}

function buildCoffee(g: THREE.Group, m: MatFn, assets: Assets): void {
  g.add(box(3.0, 0.92, 0.6, m('woodDark'), 0, 0.46, 0));
  g.add(box(3.1, 0.05, 0.66, m('wood'), 0, 0.945, 0));
  // Espresso machine.
  g.add(box(0.5, 0.48, 0.38, m('monitor'), -0.7, 1.21, 0));
  g.add(box(0.36, 0.06, 0.12, m('metal'), -0.7, 1.08, -0.2));
  // Mugs.
  ROLE_ORDER.slice(0, 4).forEach((role, k) => {
    g.add(cyl(0.055, 0.05, 0.11, accent(ROLES[role].color), 0.1 + k * 0.22, 1.025, -0.05, 12));
  });
  const plant = deskPlant(m, assets, 0.32);
  plant.position.set(1.2, 0.97, 0.05);
  g.add(plant);
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
  ROLE_ORDER.forEach((role, col) => {
    for (let k = 0; k < 2 + (col % 2); k++) {
      const note = box(0.22, 0.22, 0.02, accent(ROLES[role].color), -1.1 + col * 0.55, 2.0 - k * 0.3, 0.03);
      note.castShadow = false;
      g.add(note);
    }
  });
}
