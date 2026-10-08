import * as THREE from 'three';
import { woodFinish } from './wood';

export interface ScenePalette {
  background: string;
  floor: string;
  floorEdge: string;
  wall: string;
  wallTrim: string;
  wood: string;
  woodDark: string;
  chair: string;
  metal: string;
  monitor: string;
  screenOff: string;
  rug: string;
  plant: string;
  stem: string;
  pot: string;
  vase: string;
  soil: string;
  marble: string;
  wicker: string;
  deskPot: string;
  leafCard: string;
  board: string;
  window: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunIntensity: number;
  lampIntensity: number;
  screenGlow: number;
}

export const LIGHT: ScenePalette = {
  background: '#efe9de',
  floor: '#e3d9c8',
  floorEdge: '#cbbda6',
  wall: '#f6f1e7',
  wallTrim: '#dcd1bf',
  // Real walnut photos carry the colour (see wood.ts); these only tint them for day and night.
  wood: '#ffffff',
  woodDark: '#ffffff',
  chair: '#3c3833',
  metal: '#8a847a',
  monitor: '#2b2926',
  screenOff: '#4a4740',
  rug: '#cdbfa8',
  plant: '#6f8a5a',
  stem: '#5e7a49',
  pot: '#b8775a',
  vase: '#cbbfa7',
  soil: '#4a3a2c',
  marble: '#f1eee8',
  wicker: '#e2c39c',
  deskPot: '#7a9ecc',
  leafCard: '#ffffff',
  board: '#fbfaf6',
  window: '#dfe7ea',
  hemiSky: '#fff6e8',
  hemiGround: '#b9a98f',
  hemiIntensity: 1.5,
  sunIntensity: 2.2,
  lampIntensity: 0,
  screenGlow: 0.55,
};

export const DARK: ScenePalette = {
  background: '#1a2f57',
  floor: '#2c2822',
  floorEdge: '#1f1c18',
  wall: '#35302a',
  wallTrim: '#29251f',
  wood: '#6f6a64',
  woodDark: '#6f6a64',
  chair: '#1d1b18',
  metal: '#5d5850',
  monitor: '#151412',
  screenOff: '#26241f',
  rug: '#3b342b',
  plant: '#4c6440',
  stem: '#3d5233',
  pot: '#7d5240',
  vase: '#6a6254',
  soil: '#231c15',
  marble: '#77736b',
  wicker: '#6e5a44',
  deskPot: '#3f5470',
  leafCard: '#6f7a68',
  board: '#c9c3b6',
  window: '#26303a',
  hemiSky: '#6d86d4',
  hemiGround: '#2c3a5c',
  hemiIntensity: 0.95,
  sunIntensity: 0.35,
  lampIntensity: 5,
  screenGlow: 1.6,
};

const ca = new THREE.Color();
const cb = new THREE.Color();

/** Somewhere between night (0) and full day (1): colours and intensities blend. */
export function mixPalette(t: number): ScenePalette {
  const out = {} as Record<keyof ScenePalette, string | number>;
  for (const key of Object.keys(LIGHT) as (keyof ScenePalette)[]) {
    const a = DARK[key];
    const b = LIGHT[key];
    out[key] = typeof a === 'number' ? a + ((b as number) - a) * t : `#${ca.set(a).lerp(cb.set(b as string), t).getHexString()}`;
  }
  return out as unknown as ScenePalette;
}

const textures = new Map<string, THREE.Texture>();
export function texture(file: string, srgb = true): THREE.Texture {
  let t = textures.get(file);
  if (!t) {
    t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}models/${file}`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.set(file, t);
  }
  return t;
}

/** Fixed settings per slot, so a material looks the same whoever asks for it first. */
const SLOT_EXTRAS: Partial<Record<keyof ScenePalette, () => THREE.MeshStandardMaterialParameters>> = {
  // Low-poly crowns and single-sheet model leaves alike.
  plant: () => ({ flatShading: true, side: THREE.DoubleSide }),
  stem: () => ({ side: THREE.DoubleSide }),
  wicker: () => ({ map: texture('rattan.jpg') }),
  wood: () => woodFinish('honey'),
  woodDark: () => woodFinish('natural'),
  leafCard: () => ({ map: texture('leaf.png'), alphaTest: 0.5, side: THREE.DoubleSide }),
  marble: () => ({ roughness: 0.5 }),
  deskPot: () => ({ roughness: 0.55 }),
};

/** Shared, theme-able materials keyed by palette slot. */
export class Materials {
  private cache = new Map<keyof ScenePalette, THREE.MeshStandardMaterial>();

  get(slot: keyof ScenePalette, palette: ScenePalette, extra: THREE.MeshStandardMaterialParameters = {}) {
    let m = this.cache.get(slot);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: palette[slot] as string,
        roughness: 0.92,
        metalness: 0,
        ...extra,
        ...SLOT_EXTRAS[slot]?.(),
      });
      // Shared across objects: never disposed with one of them.
      m.userData.shared = true;
      this.cache.set(slot, m);
    }
    return m;
  }

  apply(palette: ScenePalette): void {
    for (const [slot, m] of this.cache) m.color.set(palette[slot] as string);
  }
}
