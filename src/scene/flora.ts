import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { wetten } from './ground';

/**
 * The garden's plants: a low-poly kit of real plants (user-supplied .fbx, converted to
 * garden.glb, its photos to textures/garden/*.webp): three kinds of tree in four shapes each,
 * bushes, a hedge, flowering shrubs, tufts of long grass, and flat patches of clover and daisies
 * that lie on the lawn. Real size in metres, each one standing on y = 0 round its own centre.
 * Leaves are photos with see-through edges, cut out sharp (alpha test), seen from both sides.
 */
export const FLORA = {
  trees: ['Tree-01-1', 'Tree-01-2', 'Tree-01-3', 'Tree-01-4', 'Tree-02-1', 'Tree-02-2', 'Tree-02-3', 'Tree-02-4', 'Tree-03-1', 'Tree-03-2', 'Tree-03-3', 'Tree-03-4'],
  bushes: ['Bush-01', 'Bush-02', 'Bush-03', 'Bush-04'],
  bigBush: 'Bush-05',
  hedge: 'Hedge-01',
  flowering: ['Flowers-02', 'Flowers-04'],
  grass: ['Grass-01', 'Grass-02', 'Grass-03'],
  clover: ['Clover-01', 'Clover-02', 'Clover-03', 'Clover-04', 'Clover-05'],
  daisies: ['Flowers-01', 'Flowers-03'],
} as const;

/** One plant: its pieces (one per material) and how tall it is. */
export interface Plant {
  parts: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[];
  height: number;
}

/** Foliage sways in the wind (stronger in a storm); one uniform for every plant. */
const sway = { value: new THREE.Vector2() };
export function setFoliageWind(time: number, strength: number): void {
  sway.value.set(time, strength);
}

/** How a plant moves: `bend`, how far its top goes per metre of height (grass a lot, a trunk hardly); `flutter`, how far each leaf or flower head trembles on its own (texture units). */
interface Motion {
  bend: number;
  flutter: number;
}

/**
 * A plant's material. Each placed copy carries a colour: red is how bright it is (no two
 * trees quite alike), green how far its leaves have turned (autumn).
 */
function plantMaterial(name: string, map: THREE.Texture, motion: Motion): THREE.MeshStandardMaterial {
  const bark = name.startsWith('trunk');
  const m = new THREE.MeshStandardMaterial({
    name,
    map,
    roughness: bark ? 0.95 : 0.8,
    alphaTest: bark ? 0 : 0.5,
    side: bark ? THREE.FrontSide : THREE.DoubleSide,
  });
  m.userData.shared = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = sway;
    sh.vertexShader = `uniform vec2 uSway;\nvarying float vPhase;\n${sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vPhase = 0.0;
      #ifdef USE_INSTANCING
        // Each plant on its own beat; the top moves, the foot stays.
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
        vPhase = phase;
        float lift = max( transformed.y - 0.15, 0.0 );
        float give = ${motion.bend.toFixed(3)} * uSway.y * lift * lift / ( 1.0 + lift );
        // A slow lean with the gusts, and leaves trembling on top.
        transformed.x += ( sin( uSway.x * 1.3 + phase ) + 0.3 * sin( uSway.x * 4.7 + phase * 3.0 + transformed.y ) ) * give;
        transformed.z += ( cos( uSway.x * 1.1 + phase * 1.3 ) * 0.7 + 0.3 * cos( uSway.x * 5.3 + transformed.x * 2.0 ) ) * give;
      #endif`,
    )}`;
    sh.fragmentShader = `uniform vec2 uSway;\nvarying float vPhase;\n${sh.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          // Every leaf and flower head nods on its own: the photo ripples a little in place,
          // in waves that run across it with the gusts.
          vec2 flutter = vec2(
            sin( uSway.x * 2.3 + vMapUv.y * 41.0 + vMapUv.x * 13.0 + vPhase ),
            cos( uSway.x * 1.9 + vMapUv.x * 37.0 - vMapUv.y * 11.0 + vPhase * 1.7 )
          ) * ${motion.flutter.toFixed(4)} * uSway.y;
          diffuseColor *= texture2D( map, vMapUv + flutter );
        #endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          float leafLum = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
          // Turning: greens go to ochre and rust, keeping the light and shade of the photo.
          vec3 turned = leafLum * vec3( 2.5, 1.25, 0.32 );
          diffuseColor.rgb = mix( diffuseColor.rgb, turned, ${bark ? '0.0' : 'vColor.g'} ) * vColor.r;
        #endif`,
      )}`;
  };
  m.customProgramCacheKey = () => `flora-${bark ? 'bark' : 'leaf'}-${motion.bend}-${motion.flutter}`;
  return m;
}

const MOTION: [RegExp, Motion][] = [
  [/^trunk/, { bend: 0.004, flutter: 0 }],
  [/^branch/, { bend: 0.012, flutter: 0.0018 }],
  [/^high-grass/, { bend: 0.22, flutter: 0.004 }],
  // Flowers and clover don't ripple (it looked wrong): only the shrubs they grow on lean.
  [/^(clover|flowers)/, { bend: 0.12, flutter: 0 }],
  [/^(shrubbery|hedge)/, { bend: 0.06, flutter: 0.003 }],
];

let loading: Promise<Map<string, Plant>> | null = null;

/** The kit, loaded once (and shared by every rebuild of the garden). */
export function loadFlora(): Promise<Map<string, Plant>> {
  loading ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const gltf = await new GLTFLoader().loadAsync(`${base}models/garden.glb`);
    const textures = new THREE.TextureLoader();
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const material = (name: string) => {
      let m = materials.get(name);
      if (m) return m;
      const map = textures.load(`${base}textures/garden/${name}.webp`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
      m = plantMaterial(name, map, MOTION.find(([re]) => re.test(name))?.[1] ?? { bend: 0.03, flutter: 0.002 });
      // Leaves and bark darken and shine a little in the rain.
      wetten(m, name.startsWith('trunk') ? 0.35 : 0.42, name.startsWith('trunk') ? 0.35 : 0.18);
      materials.set(name, m);
      return m;
    };
    const plants = new Map<string, Plant>();
    for (const node of gltf.scene.children) {
      const parts: Plant['parts'] = [];
      const box = new THREE.Box3().setFromObject(node);
      node.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.userData.shared = true;
        parts.push({ geometry: o.geometry, material: material((o.material as THREE.Material).name) });
      });
      plants.set(node.name, { parts, height: box.max.y - box.min.y });
    }
    return plants;
  })();
  return loading;
}

/** Where one copy goes: position, turn, size, and its colour (see plantMaterial). */
export interface Planting {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  bright: number;
  autumn: number;
}

/**
 * Put copies of one plant in the garden, one instanced mesh per piece. `shadows`: whether they
 * cast them (trees and bushes do; the grass and flowers at your feet only receive them).
 */
export function plant(group: THREE.Group, p: Plant, list: Planting[], shadows: boolean): void {
  if (!list.length) return;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  for (const part of p.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
    list.forEach((t, i) => {
      mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, t.yaw), new THREE.Vector3(t.scale, t.scale, t.scale)));
      mesh.setColorAt(i, color.setRGB(t.bright, t.autumn, 0));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.userData.shared = true;
    group.add(mesh);
  }
}

