import * as THREE from 'three';

/**
 * Real walnut veneer in five tones (scanned colour photos). Floors and walls cut their boards
 * out of the photo (see floors.ts); desk tops, doors and shelves wear it as is. Colour only:
 * relief and sheen maps tripled the graphics memory for a difference nobody sees from here.
 */
export type WoodTone = 'honey' | 'natural' | 'smoked' | 'red' | 'dark';

const FILE: Record<WoodTone, string> = { honey: 'y', natural: 'a', smoked: 'g', red: 'r', dark: 'b' };
const TONES = Object.keys(FILE) as WoodTone[];
const url = (tone: WoodTone) => `${import.meta.env.BASE_URL}textures/wood/${FILE[tone]}-color.jpg`;

const images = new Map<WoodTone, HTMLImageElement>();
const ready: (() => void)[] = [];
let loading = false;
let pending = TONES.length;

function load(): void {
  if (loading) return;
  loading = true;
  for (const tone of TONES) {
    const img = new Image();
    img.decoding = 'async';
    const done = () => {
      // Whatever arrived is used; anything that failed keeps the painted fallback.
      if (--pending === 0) for (const cb of ready.splice(0)) cb();
    };
    img.onload = () => {
      images.set(tone, img);
      done();
    };
    img.onerror = done;
    img.src = url(tone);
  }
}

/** The colour photo of one tone, once it has loaded (null until then). */
export function woodImage(tone: WoodTone): HTMLImageElement | null {
  load();
  return images.get(tone) ?? null;
}

/** Runs once every photo has loaded (or failed): canvases painted before then repaint. */
export function whenWoodLoaded(cb: () => void): void {
  load();
  if (pending === 0) cb();
  else ready.push(cb);
}

const maps = new Map<WoodTone, THREE.Texture>();

/** The photo of one tone as a texture, for a surface with its own UVs. */
export function woodMap(tone: WoodTone): THREE.Texture {
  let t = maps.get(tone);
  if (!t) {
    t = new THREE.TextureLoader().load(url(tone));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    maps.set(tone, t);
  }
  return t;
}

/** Material settings for one tone: a lightly oiled finish. */
export function woodFinish(tone: WoodTone): THREE.MeshStandardMaterialParameters {
  return { map: woodMap(tone), roughness: 0.6, metalness: 0 };
}
