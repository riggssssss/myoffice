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
export type WindowKind = (typeof WINDOW_KINDS)[number];
const SOFA_KINDS = ['Laszlo'] as const;
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
export const loadWindows = () => loadNodes('windows.glb', WINDOW_KINDS);

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

/** Laszlo bouclé loveseat (user-supplied .obj, converted): real size, seat facing +z, centred, on y = 0. */
export async function loadSofas(): Promise<Map<SofaKind, THREE.Object3D>> {
  const out = await loadNodes('sofa.glb', SOFA_KINDS);
  // The model came without its fabric: bouclé is drawn here, tiny wool loops as colour and relief.
  const loops = boucleTexture();
  out.get('Laszlo')?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.MeshStandardMaterial;
    if (m.name !== 'boucle') return;
    m.map = loops;
    m.bumpMap = loops;
    m.bumpScale = 2.2;
    m.color.set('#ffffff');
    m.needsUpdate = true;
  });
  return out;
}

/** Bouclé: a dense tangle of small wool loops, ivory on ivory. Tiles seamlessly. */
function boucleTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e1d2';
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 1.6 + rnd() * 2.4;
    const light = rnd() > 0.45;
    g.strokeStyle = light ? `rgba(255,252,246,${0.55 + rnd() * 0.4})` : `rgba(160,146,124,${0.25 + rnd() * 0.3})`;
    g.lineWidth = 0.8 + rnd() * 0.9;
    // Draw each loop at its wrapped positions too, so the tile has no seams.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        if (x + dx < -6 || x + dx > size + 6 || y + dy < -6 || y + dy > size + 6) continue;
        g.beginPath();
        g.arc(x + dx, y + dy, r, rnd() * 6.28, rnd() * 6.28 + 3.5 + rnd() * 2);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.anisotropy = 4;
  return t;
}
