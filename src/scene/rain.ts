import * as THREE from 'three';
import { WALL_H, WALL_T, type Room } from '../sim/layout';

/**
 * Rain: thin streaks falling round the building (never inside: the office has a roof, we just
 * don't draw it), slanting with the wind. How hard it rains thins or fills them in smoothly:
 * each drop has its own threshold, so light rain is the same sky with fewer drops. An unseen
 * roof hides the drops that would show through it (those falling behind the building).
 */
const DROPS = 7000;
/** How far out round the building it rains, and from how high. */
const REACH = 26;
const HEIGHT = 16;
const SPEED = 11;
const LENGTH = 0.42;

const VERTEX = /* glsl */ `
attribute float aSeed;
attribute float aEnd;
uniform float uTime;
uniform float uRain;
uniform vec2 uWind;
varying float vAlpha;
void main() {
  // Above this drop's threshold the rain isn't heavy enough for it: tuck it away.
  float on = step( aSeed, uRain );
  float fall = mod( aSeed * 97.0 * ${HEIGHT.toFixed(1)} - uTime * ${SPEED.toFixed(1)}, ${HEIGHT.toFixed(1)} );
  vec3 p = position;
  p.y += fall + aEnd * ${LENGTH.toFixed(2)};
  // Slanted with the wind: the top of each streak is upwind.
  p.xz += uWind * ( fall + aEnd * ${LENGTH.toFixed(2)} );
  vAlpha = on * ( 0.25 + 0.75 * aEnd ) * smoothstep( 0.0, 1.2, fall );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4( uColor, vAlpha * uOpacity );
}
`;

export class Rain {
  readonly mesh: THREE.LineSegments;
  /** The roof, drawn only into depth just before the rain. */
  private roof = new THREE.Group();
  private uniforms = {
    uTime: { value: 0 },
    uRain: { value: 0 },
    uWind: { value: new THREE.Vector2(0.06, 0.025) },
    uColor: { value: new THREE.Color('#c9d4de') },
    uOpacity: { value: 0.32 },
  };
  private builtFor = '';

  constructor() {
    this.mesh = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms, transparent: true, depthWrite: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 11;
    this.mesh.add(this.roof);
  }

  /** Scatter the drops round the building, keeping clear of every room. */
  place(rooms: readonly Room[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    const key = JSON.stringify(rooms.map((r) => [r.x0, r.x1, r.z0, r.z1]));
    if (key === this.builtFor) return;
    this.builtFor = key;
    const inside = (x: number, z: number) => rooms.some((r) => x > r.x0 - 0.3 && x < r.x1 + 0.3 && z > r.z0 - 0.3 && z < r.z1 + 0.3);
    const pos = new Float32Array(DROPS * 6);
    const seed = new Float32Array(DROPS * 2);
    const end = new Float32Array(DROPS * 2);
    const y = -WALL_T;
    for (let i = 0; i < DROPS; i++) {
      let x = 0;
      let z = 0;
      do {
        x = bounds.minX - REACH + Math.random() * (bounds.maxX - bounds.minX + REACH * 2);
        z = bounds.minZ - REACH + Math.random() * (bounds.maxZ - bounds.minZ + REACH * 2);
      } while (inside(x, z));
      pos.set([x, y, z, x, y, z], i * 6);
      const s = Math.random();
      seed[i * 2] = seed[i * 2 + 1] = s;
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    for (const c of [...this.roof.children]) {
      this.roof.remove(c);
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    const roofMat = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, side: THREE.DoubleSide });
    for (const r of rooms) {
      const lid = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0 + WALL_T, r.z1 - r.z0 + WALL_T).rotateX(-Math.PI / 2), roofMat);
      lid.position.set((r.x0 + r.x1) / 2, WALL_H, (r.z0 + r.z1) / 2);
      lid.renderOrder = 10;
      this.roof.add(lid);
    }
    const g = this.mesh.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  }

  /** `rain` 0–1, `wind` as a multiple of a breeze, `night` 0–1 (drops show less in the dark). */
  update(dt: number, rain: number, wind: number, night: number, reduced: boolean): void {
    this.mesh.visible = rain > 0.01;
    if (!this.mesh.visible) return;
    // Reduced motion: a slow drizzle rather than a rush.
    this.uniforms.uTime.value += dt * (reduced ? 0.15 : 1);
    this.uniforms.uRain.value = rain;
    this.uniforms.uWind.value.set(0.05 * wind, 0.02 * wind);
    this.uniforms.uOpacity.value = 0.34 * (1 - 0.55 * night);
  }
}
