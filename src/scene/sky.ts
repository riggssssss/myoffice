import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * The sky as light: two real outdoor HDRs (a clear day and an overcast one; their sun taken
 * out, ours is where the real one is now), blended by how grey the weather is and darkened by
 * rain, so the light changes as gradually as the weather does. The blend is baked into the
 * scene's environment (reflections and sky fill) only when it has moved a visible amount.
 */
const MIN_STEP = 0.025;
const MIN_GAP_MS = 1500;
/** The overcast photo is dimmer than the clear one; this brings it to a similar brightness. */
const OVERCAST_GAIN = 1.35;

const FRAGMENT = /* glsl */ `
#include <common>
uniform sampler2D uClear;
uniform sampler2D uOvercast;
uniform float uMix;
uniform float uGain;
varying vec3 vDir;
void main() {
  vec2 uv = equirectUv( normalize( vDir ) );
  vec3 c = mix( texture2D( uClear, uv ).rgb, texture2D( uOvercast, uv ).rgb * ${OVERCAST_GAIN.toFixed(2)}, uMix );
  gl_FragColor = vec4( c * uGain, 1.0 );
}
`;

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

export class SkyLight {
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private uniforms = {
    uClear: { value: null as THREE.Texture | null },
    uOvercast: { value: null as THREE.Texture | null },
    uMix: { value: 0 },
    uGain: { value: 1 },
  };
  private target: THREE.WebGLRenderTarget | null = null;
  private baked = { mix: -1, gain: -1, at: 0 };

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(10, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false }),
    );
    this.scene.add(sphere);
    const load = (name: string, key: 'uClear' | 'uOvercast') =>
      new HDRLoader().load(`${import.meta.env.BASE_URL}textures/sky/${name}.hdr`, (t) => {
        t.minFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        this.uniforms[key].value = t;
        this.baked.mix = -1;
      });
    load('clear', 'uClear');
    load('overcast', 'uOvercast');
  }

  /**
   * `grey` 0–1 (clear → overcast), `rain` 0–1. Returns a new environment when it re-baked one
   * (the previous one is freed), else null.
   */
  update(grey: number, rain: number): THREE.Texture | null {
    if (!this.uniforms.uClear.value || !this.uniforms.uOvercast.value) return null;
    const mix = Math.min(1, grey * 1.4);
    const gain = 1 - 0.45 * rain;
    const moved = Math.max(Math.abs(mix - this.baked.mix), Math.abs(gain - this.baked.gain));
    const now = performance.now();
    if (moved < MIN_STEP || (this.baked.mix >= 0 && now - this.baked.at < MIN_GAP_MS)) return null;
    this.uniforms.uMix.value = mix;
    this.uniforms.uGain.value = gain;
    this.baked = { mix, gain, at: now };
    const next = this.pmrem.fromScene(this.scene, 0, 0.1, 50);
    this.target?.dispose();
    this.target = next;
    return next.texture;
  }
}
