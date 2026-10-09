import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ScenePalette } from './palette';

/**
 * User-supplied plant models, converted to GLB. Every node is 1 unit tall, rests on
 * y = 0 and is centred on its pot.
 * - plants.glb: bird-of-paradise; the two low arrangements are used.
 * - decor.glb: wicker basket, bush in a pot, and a leafy desk plant.
 * (desks.glb shares the loader but keeps real size; see loadDesks.)
 */
const PLANT_KINDS = ['PlantLowA', 'PlantLowB'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];
const DECOR_KINDS = ['WickerVase', 'BushPlant', 'DeskPlant'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];
const DESK_KINDS = ['OgiM', 'OgiY'] as const;
export type DeskKind = (typeof DESK_KINDS)[number];
const CHAIR_KINDS = ['Renya', 'Sava', 'Roundish'] as const;
export type ChairKind = (typeof CHAIR_KINDS)[number];
const WINDOW_KINDS = ['Window', 'DoorWindow'] as const;
const CLASSIC_WINDOW = ['Classic'] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number] | (typeof CLASSIC_WINDOW)[number];
const SOFA_KINDS = ['Nari'] as const;
const LAMP_KINDS = ['Jwda'] as const;
export type LampKind = (typeof LAMP_KINDS)[number];
/** Menu JWDA table lamp (user-supplied .obj, converted, no cable): opal glass globe on a stone foot, 1.3 × real size (38 cm), centred, on y = 0, dimmer towards +z. */
export const loadLamps = () => loadNodes('lamp.glb', LAMP_KINDS);
export type SofaKind = (typeof SOFA_KINDS)[number];

/** Material name in the GLB → palette slot, so the plants follow day/night like the rest of the room. */
const SLOTS: Record<string, keyof ScenePalette> = {
  leaf: 'plant',
  stem: 'stem',
  vase: 'vase',
  pot: 'vase',
  soil: 'soil',
  pebble: 'soil',
  marble: 'marble',
  wicker: 'wicker',
  deskPot: 'deskPot',
  leafCard: 'leafCard',
};

async function loadNodes<K extends string>(file: string, kinds: readonly K[]): Promise<Map<K, THREE.Object3D>> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`);
  const out = new Map<K, THREE.Object3D>();
  for (const kind of kinds) {
    const node = gltf.scene.getObjectByName(kind);
    if (!node) continue;
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Decimated parts lost their normals.
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.castShadow = true;
      o.receiveShadow = true;
      // Geometry is shared by every copy placed in the room.
      o.userData.shared = true;
    });
    out.set(kind, node);
  }
  return out;
}

export const loadPlants = () => loadNodes('plants.glb', PLANT_KINDS);
export const loadDecor = () => loadNodes('decor.glb', DECOR_KINDS);
/** Ogi desks (user-supplied .blend files, converted): 2.0 × 0.8 m, top at 0.74 m, centred on the top. */
export const loadDesks = () => loadNodes('desks.glb', DESK_KINDS);
/** Chairs (user-supplied .blend / .fbx, converted): real size, facing +z, centred, on y = 0. */
export const loadChairs = () => loadNodes('chairs.glb', CHAIR_KINDS);
/**
 * Windows (user-supplied .fbx, converted): a two-leaf slider and a floor-length door window,
 * real size, centred on the opening and the frame depth, y = 0 at floor level.
 */
export const loadWindows = async (): Promise<Map<WindowKind, THREE.Object3D>> => {
  // The classic one (user-supplied .fbx «Window W01», converted): 1.26 × 1.96 m, sill 0.5 m, slimmed to the wall.
  const [base, classic] = await Promise.all([loadNodes('windows.glb', WINDOW_KINDS), loadNodes('window-classic.glb', CLASSIC_WINDOW).catch(() => new Map())]);
  const out = new Map<WindowKind, THREE.Object3D>([...base, ...classic]);
  // The models have no texture coordinates: the frames get them projected, so wood shows its grain.
  for (const win of out.values()) {
    win.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'frame' && !o.geometry.attributes.uv) boxUvs(o.geometry);
    });
  }
  return out;
};

/**
 * Texture coordinates by box projection: each face takes the two axes it lies along, so the
 * grain runs along the uprights and the rails. One tile every 0.6 m. Uses the mesh's own scale.
 */
function boxUvs(g: THREE.BufferGeometry): void {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const k = 1 / 0.6;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** A themed copy of one plant, `height` tall, with materials taken from the shared palette set. */
export function placePlant(
  template: THREE.Object3D,
  material: (slot: keyof ScenePalette) => THREE.Material,
  height: number,
): THREE.Object3D {
  const plant = template.clone(true);
  plant.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const name = (o.material as THREE.Material).name;
      o.material = material(SLOTS[name] ?? 'plant');
    }
  });
  plant.position.set(0, 0, 0);
  plant.rotation.set(0, 0, 0);
  plant.scale.setScalar(height);
  return plant;
}

/** The sofa's velvet: one material shared by every sofa in the room, its colour from Ajustes. */
const velvet = new THREE.MeshPhysicalMaterial({ name: 'velvet', roughness: 0.82, sheen: 1, sheenRoughness: 0.38 });
velvet.userData.shared = true;

/** Dyes the velvet (any #rrggbb); the sheen is the same colour, lighter, as velvet catches light. */
export function setSofaColor(hex: string): void {
  velvet.color.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  velvet.color.getHSL(hsl);
  velvet.sheenColor.setHSL(hsl.h, hsl.s * 0.7, Math.min(0.92, hsl.l + 0.35));
}

/** Nari tufted sofa (user-supplied .fbx, converted and lightened): real size, seat facing +z, centred, on y = 0. */
export async function loadSofas(): Promise<Map<SofaKind, THREE.Object3D>> {
  const out = await loadNodes('sofa.glb', SOFA_KINDS);
  // The model came without its textures: the upholstery is velvet, plain, its colour chosen in Ajustes.
  out.get('Nari')?.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'fabric') o.material = velvet;
  });
  return out;
}

