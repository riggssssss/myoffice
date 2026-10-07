import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ScenePalette } from './palette';

/**
 * User-supplied plant models, converted to GLB. Every node is 1 unit tall, rests on
 * y = 0 and is centred on its pot.
 * - plants.glb: bird-of-paradise in four arrangements (the tall pair stand on a marble plinth).
 * - decor.glb: wicker basket, bush in a pot, and a leafy desk plant.
 * (desks.glb shares the loader but keeps real size; see loadDesks.)
 */
const PLANT_KINDS = ['PlantTallA', 'PlantTallB', 'PlantLowA', 'PlantLowB'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];
const DECOR_KINDS = ['WickerVase', 'BushPlant', 'DeskPlant'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];
const DESK_KINDS = ['OgiM', 'OgiY'] as const;
export type DeskKind = (typeof DESK_KINDS)[number];

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
