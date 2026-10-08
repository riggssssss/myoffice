import * as THREE from 'three';

import type { WeatherMix } from './weather';

/**
 * Cloud shadows: a layer of cumulus high above, drifting with the wind. They only take away the
 * sun's direct light (sky light still comes through), cast along the sun's direction, so a big
 * soft patch of shade slides over the ground, up a wall and across the floors indoors as if a
 * real cloud had covered the sun. Two layers drift at slightly different speeds, so the shapes
 * slowly change as they go. Every lit material in the scene reads the same layer.
 */
const SIZE = 256;
/** Height of the cloud layer (m) and how big one turn of the pattern is on the ground. */
const LAYER = 900;
const SCALE = 380;
/** Wind at cloud height: metres a second over the ground, before the weather's own wind. */
const WIND = new THREE.Vector2(1.6, 0.65);
/** The upper layer: a little faster and off-angle, so shapes grow and break up as they pass. */
const WIND2 = new THREE.Vector2(1.6 * 1.35, 0.65 * 1.35 + 0.3);
/**
 * The rim: how wide each cloud's penumbra is (in the pattern's 0–1 range). It varies from cloud
 * to cloud, as it does in the sky: some edges crisp, others soft.
 */
const RIM_SHARP = 0.012;
const RIM_SOFT = 0.085;

/** Tileable value noise: a few big shapes with smaller billows on their edges, evened out 0–1. */
function cloudField(): Float32Array {
  const rand = (x: number, y: number, s: number) => {
    let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1;
  for (let o = 0, cells = 4; o < 5; o++, cells *= 2, amp *= 0.48) {
    const k = SIZE / cells;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const gx = x / k;
        const gy = y / k;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        // Quintic smoothing: no grid creases in the soft edges.
        const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
        const sx = q(gx - x0);
        const sy = q(gy - y0);
        const c = (i: number, j: number) => rand((x0 + i) % cells, (y0 + j) % cells, o);
        const v = (c(0, 0) * (1 - sx) + c(1, 0) * sx) * (1 - sy) + (c(0, 1) * (1 - sx) + c(1, 1) * sx) * sy;
        // Billows: the small octaves round the edges off instead of fraying them.
        out[y * SIZE + x] += (o < 2 ? v : 1 - Math.abs(v * 2 - 1)) * amp;
      }
    }
  }
  // Evened out (by rank), so «cover» is the share of the sky that's cloud.
  const order = [...out.keys()].sort((a, b) => out[a] - out[b]);
  order.forEach((idx, rank) => (out[idx] = rank / (order.length - 1)));
  return out;
}

const field = cloudField();
/** Also the puddles' map (see ground.ts): organic blobs at any scale. */
export const noiseTexture = (() => {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < field.length; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4 + 3] = Math.round(field[i] * 255);
  const t = new THREE.DataTexture(data, SIZE, SIZE);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
})();

/** Shared by every patched material: one update moves the clouds everywhere. */
const uniforms = {
  uCloudTex: { value: noiseTexture },
  /** xy: how far the main layer has drifted (in pattern turns); z: how much sky is cloud; w: how dark their shade. */
  uCloud: { value: new THREE.Vector4(0, 0, 0.3, 0.6) },
  /** The second, smaller layer's drift. */
  uCloud2: { value: new THREE.Vector2() },
  /** Toward the sun. */
  uCloudSun: { value: new THREE.Vector3(0, 1, 0) },
};

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uCloudTex;
uniform vec4 uCloud;
uniform vec2 uCloud2;
uniform vec3 uCloudSun;
varying vec3 vCloudW;
float cloudLight() {
  vec3 L = normalize( uCloudSun );
  // Where the ray from this point to the sun crosses the cloud layer.
  vec2 q = vCloudW.xz + L.xz * ( ( ${LAYER.toFixed(1)} - vCloudW.y ) / max( L.y, 0.12 ) );
  q /= ${SCALE.toFixed(1)};
  float n = texture2D( uCloudTex, q + uCloud.xy ).r * 0.68 + texture2D( uCloudTex, q * 1.7 + uCloud2 ).r * 0.32;
  n = ( n - 0.5 ) * 1.35 + 0.5;
  // Crisp or soft rim, depending on the cloud (a slow field drifting with them).
  float rim = mix( ${RIM_SHARP.toFixed(3)}, ${RIM_SOFT.toFixed(3)}, smoothstep( 0.3, 0.7, texture2D( uCloudTex, q * 0.31 + uCloud.xy * 0.5 + 0.71 ).r ) );
  float c = smoothstep( 1.0 - uCloud.z - rim * 0.6, 1.0 - uCloud.z + rim, n );
  return 1.0 - uCloud.w * c;
}
`;

const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudK;',
);

/** Let one material feel the clouds (keeps whatever else it does to its shader). */
function withClouds(m: THREE.Material): void {
  if (m.userData.clouds) return;
  m.userData.clouds = true;
  const before = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    before(sh, r);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `varying vec3 vCloudW;\n${sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 cloudW = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        cloudW = batchingMatrix * cloudW;
      #endif
      #ifdef USE_INSTANCING
        cloudW = instanceMatrix * cloudW;
      #endif
      vCloudW = ( modelMatrix * cloudW ).xyz;`,
    )}`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <lights_fragment_begin>', `float cloudK = cloudLight();\n${LIGHTS}`);
  };
  m.customProgramCacheKey = () => `${key()}|clouds`;
  m.needsUpdate = true;
}

const lit = (m: THREE.Material) =>
  m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial;

/** Patch whatever in the scene is lit by the sun and isn't yet (new furniture, people…). */
export function cloudify(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (lit(m)) withClouds(m);
  });
}

const drift = new THREE.Vector2();
const drift2 = new THREE.Vector2();

/** Move the clouds on with the weather's wind; their cover and shade follow the weather too. */
export function updateClouds(dt: number, toSun: THREE.Vector3, w: WeatherMix, sunUp: number): void {
  drift.addScaledVector(WIND, (dt * w.wind) / SCALE);
  drift2.addScaledVector(WIND2, (dt * w.wind) / SCALE);
  drift.set(drift.x % 1, drift.y % 1);
  drift2.set(drift2.x % 1, drift2.y % 1);
  // Darker clouds cast darker shade: a fair-weather cloud takes about half the sun, a storm
  // cloud nearly all of it. The darkening of a grey day is the clouds' shade, not a dimmer sun.
  uniforms.uCloud.value.set(drift.x, drift.y, w.cover, (0.66 + 0.3 * w.dark) * sunUp);
  uniforms.uCloud2.value.copy(drift2);
  uniforms.uCloudSun.value.copy(toSun);
}

function sample(u: number, v: number): number {
  u = (((u * SIZE) % SIZE) + SIZE) % SIZE;
  v = (((v * SIZE) % SIZE) + SIZE) % SIZE;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const f = (i: number, j: number) => field[((y0 + j) % SIZE) * SIZE + ((x0 + i) % SIZE)];
  return (f(0, 0) * (1 - fx) + f(1, 0) * fx) * (1 - fy) + (f(0, 1) * (1 - fx) + f(1, 1) * fx) * fy;
}

/** How much direct sun gets through at one spot on the ground (1: clear, lower: under a cloud). */
export function sunThrough(x: number, z: number): number {
  const L = uniforms.uCloudSun.value.clone().normalize();
  const t = LAYER / Math.max(L.y, 0.12);
  const qx = (x + L.x * t) / SCALE;
  const qz = (z + L.z * t) / SCALE;
  const c = uniforms.uCloud.value;
  let n = sample(qx + c.x, qz + c.y) * 0.68 + sample(qx * 1.7 + drift2.x, qz * 1.7 + drift2.y) * 0.32;
  n = (n - 0.5) * 1.35 + 0.5;
  const k = Math.min(1, Math.max(0, (sample(qx * 0.31 + c.x * 0.5 + 0.71, qz * 0.31 + c.y * 0.5 + 0.71) - 0.3) / 0.4));
  const rim = RIM_SHARP + (RIM_SOFT - RIM_SHARP) * k * k * (3 - 2 * k);
  const a = 1 - c.z - rim * 0.6;
  const b = 1 - c.z + rim;
  const s = Math.min(1, Math.max(0, (n - a) / (b - a)));
  return 1 - c.w * s * s * (3 - 2 * s);
}
