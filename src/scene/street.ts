import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BenchModel, LampModel } from '../sim/layout';
import { wetten } from './ground';
import { woodFinish } from './wood';

/**
 * The street furniture in the garden, one model of each chosen in «Editar oficina»:
 * - bench.glb: «Maro», cast-stone ends and wooden slats, 1.8 m (user-supplied .obj; its tiny
 *   bolts left out: most of the triangles, none of the look).
 * - street.glb: a wrought-iron park bench, 1.27 m, and five classic lamp posts, 3.3–4.4 m
 *   (user-supplied .fbx). Each lamp is two pieces: the iron, and the glass that lights up.
 * Everything faces +z and stands on y = 0, real size. The modern lamp is drawn here, not loaded.
 * All of it gets wet in the rain (see wetten).
 */
const LAMP_NODES: Partial<Record<LampModel, string>> = {
  lantern2: 'Lamp-1',
  lantern: 'Lamp-2',
  globes2: 'Lamp-3',
  crook: 'Lamp-4',
  globes3: 'Lamp-5',
};
/** Lamps with arms both ways are turned so the arms run along the street, not across it. */
const ALONG: LampModel[] = ['lantern2', 'globes2', 'globes3'];

const shared = <T extends THREE.Material>(m: T, gloss: number, darken: number): T => {
  m.userData.shared = true;
  wetten(m, gloss, darken);
  return m;
};

const MAT = {
  stone: shared(new THREE.MeshStandardMaterial({ color: '#b3ada3', roughness: 0.92 }), 0.35, 0.3),
  wood: shared(new THREE.MeshStandardMaterial(woodFinish('natural')), 0.16, 0.3),
  iron: shared(new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.5, metalness: 0.6 }), 0.12, 0.15),
  /** The lamps' glass and the modern lamp's bulb: they glow at night (see streetNight). */
  glass: new THREE.MeshStandardMaterial({ color: '#efe7d6', emissive: '#ffd59a', emissiveIntensity: 0, roughness: 0.2 }),
  bulb: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd7a0', emissiveIntensity: 0, roughness: 0.3 }),
};
MAT.glass.userData.shared = MAT.bulb.userData.shared = true;

/** Material name in the models → finish. */
const FINISH: Record<string, THREE.Material> = {
  concrete: MAT.stone,
  slats: MAT.wood,
  bracket: MAT.iron,
  iron: MAT.iron,
  metal: MAT.iron,
  glass: MAT.glass,
};

/** Street lamps: 0 by day, 1 at night. */
export function streetNight(k: number): void {
  MAT.glass.emissiveIntensity = 2.2 * k;
  MAT.bulb.emissiveIntensity = 2.4 * k;
}

interface Models {
  bench: Partial<Record<BenchModel, THREE.Object3D>>;
  lamp: Partial<Record<LampModel, THREE.Object3D>>;
}
let models: Models | null = null;
let loading: Promise<Models> | null = null;

function prepare(node: THREE.Object3D): THREE.Object3D {
  node.position.set(0, 0, 0);
  node.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = FINISH[(o.material as THREE.Material).name] ?? MAT.iron;
    o.geometry.userData.shared = true;
    o.userData.shared = true;
    o.castShadow = o.receiveShadow = true;
  });
  return node;
}

/** Both files, loaded once and shared by every rebuild of the garden (and the editor's pictures). */
export function loadStreet(): Promise<Models> {
  loading ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const loader = new GLTFLoader();
    const [maro, street] = await Promise.all([loader.loadAsync(`${base}models/bench.glb`), loader.loadAsync(`${base}models/street.glb`)]);
    const m: Models = { bench: {}, lamp: {} };
    const maroNode = maro.scene.getObjectByName('Maro');
    if (maroNode) m.bench.maro = prepare(maroNode);
    const park = street.scene.getObjectByName('Bank02');
    if (park) m.bench.park = prepare(park);
    for (const [id, name] of Object.entries(LAMP_NODES) as [LampModel, string][]) {
      const node = street.scene.getObjectByName(name);
      if (node) m.lamp[id] = prepare(node);
    }
    models = m;
    return m;
  })();
  return loading;
}

/** Whether the models are in (the editor's pictures wait for them). */
export const streetReady = () => models !== null;

/** A bench, facing +z, or null until the models are in. */
export function benchObject(model: BenchModel): THREE.Object3D | null {
  const src = models?.bench[model];
  return src ? src.clone() : null;
}

/** The modern lamp: a plain post with its arm out over the road (+z). */
function modernLamp(): THREE.Group {
  const lamp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 3.9, 10), MAT.iron);
  post.position.y = 1.95;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.7), MAT.iron);
  arm.position.set(0, 3.85, 0.32);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.42), MAT.iron);
  head.position.set(0, 3.8, 0.66);
  const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.36).rotateX(Math.PI / 2), MAT.bulb);
  bulb.position.set(0, 3.745, 0.66);
  lamp.add(post, arm, head, bulb);
  lamp.traverse((m) => (m.castShadow = true));
  return lamp;
}

/**
 * A lamp post, its arm (if it has one) out over the road along +z, or null until the models
 * are in. `reach`: how far out from the post its light falls (0: all round it).
 */
export function lampObject(model: LampModel): { obj: THREE.Object3D; reach: number } | null {
  if (model === 'modern') return { obj: modernLamp(), reach: 0.65 };
  const src = models?.lamp[model];
  if (!src) return null;
  const obj = new THREE.Group();
  const lamp = src.clone();
  if (ALONG.includes(model)) lamp.rotation.y = Math.PI / 2;
  obj.add(lamp);
  return { obj, reach: model === 'crook' ? 0.25 : 0 };
}
