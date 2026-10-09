import * as THREE from 'three';

let speckle: THREE.CanvasTexture | null = null;
let grain: THREE.CanvasTexture | null = null;

function canvas(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Seeded so every load paints the same freckles. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * Near-white with fine darker and lighter flecks. Used as a colour map it multiplies
 * the material colour, giving the soft "painted vinyl toy" speckle of the reference.
 */
export function speckleMap(): THREE.CanvasTexture {
  if (speckle) return speckle;
  speckle = canvas(256, (ctx, s) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, s, s);
    const r = rng(7);
    for (let i = 0; i < 2600; i++) {
      const light = r() < 0.35;
      const v = light ? 255 : 200 + Math.floor(r() * 30);
      ctx.fillStyle = `rgba(${v},${v},${v},${light ? 0.9 : 0.55})`;
      ctx.beginPath();
      ctx.arc(r() * s, r() * s, 0.4 + r() * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  speckle.colorSpace = THREE.SRGBColorSpace;
  speckle.repeat.set(3, 3);
  return speckle;
}

/** Soft noise for bump: makes surfaces read as matte clay instead of plastic. */
export function grainMap(): THREE.CanvasTexture {
  if (grain) return grain;
  grain = canvas(128, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const r = rng(11);
    for (let i = 0; i < s * s; i++) {
      const v = 118 + Math.floor(r() * 20);
      img.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  });
  grain.repeat.set(4, 4);
  return grain;
}

/** Woven fabric for shirts and trousers: faint diagonal twill over the speckle. */
let twill: THREE.CanvasTexture | null = null;
export function twillMap(): THREE.CanvasTexture {
  if (twill) return twill;
  twill = canvas(128, (ctx, s) => {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(205,205,205,0.6)';
    ctx.lineWidth = 1;
    for (let i = -s; i < s * 2; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + s, s);
      ctx.stroke();
    }
    const r = rng(23);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.4})`;
      ctx.fillRect(r() * s, r() * s, 1, 1);
    }
  });
  twill.colorSpace = THREE.SRGBColorSpace;
  twill.repeat.set(4, 4);
  return twill;
}

/** A solid block standing on the ground: footprint plus height above the ground. */
export interface ShadowBlock {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
}

type V2 = [number, number];

/** Convex hull (monotone chain). */
function hull(points: V2[]): V2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: V2[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The shadow the model casts on the ground it stands on, for a light whose shadow moves
 * `lean` metres sideways per metre of height. Each block's shadow is the hull of its base and
 * its top pushed along the light. Painted blurred: dark where the model touches the ground,
 * fading softly along the cast. Canvas covers `bounds` (x left→right, z top→bottom).
 */
export function groundShadow(
  blocks: ShadowBlock[],
  bounds: { x0: number; x1: number; z0: number; z1: number },
  lean: { x: number; z: number },
): THREE.CanvasTexture {
  const scale = 48; // px per metre
  const c = document.createElement('canvas');
  c.width = Math.round((bounds.x1 - bounds.x0) * scale);
  c.height = Math.round((bounds.z1 - bounds.z0) * scale);
  const ctx = c.getContext('2d')!;
  const px = (x: number, z: number): V2 => [(x - bounds.x0) * scale, (z - bounds.z0) * scale];
  // Draw shapes off-canvas and keep only their blurred shadow (works without ctx.filter).
  const off = c.width + 200;
  ctx.shadowOffsetX = off;
  const poly = (pts: V2[]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - off, y) : ctx.moveTo(x - off, y)));
    ctx.closePath();
    ctx.fill();
  };
  const layer = (blur: number, alpha: number, shapes: V2[][]) => {
    ctx.shadowBlur = blur;
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.fillStyle = '#000';
    for (const s of shapes) poly(s);
  };
  const base = (b: ShadowBlock): V2[] => [px(b.x0, b.z0), px(b.x1, b.z0), px(b.x1, b.z1), px(b.x0, b.z1)];
  const cast = (b: ShadowBlock): V2[] => {
    const dx = lean.x * b.h;
    const dz = lean.z * b.h;
    return hull([
      ...base(b),
      px(b.x0 + dx, b.z0 + dz),
      px(b.x1 + dx, b.z0 + dz),
      px(b.x1 + dx, b.z1 + dz),
      px(b.x0 + dx, b.z1 + dz),
    ]);
  };
  // Long, soft cast first, then a tight dark band where the model meets the ground.
  layer(30, 0.32, blocks.map(cast));
  layer(7, 0.5, blocks.map(base));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Soft dark footprint (a box or a disc), blurred out to its rim: the shade an object throws on
 * the floor right under it, where sky and lamps can't reach (fake ambient occlusion).
 */
const footprints = new Map<'box' | 'disc', THREE.CanvasTexture>();
function footprint(shape: 'box' | 'disc'): THREE.CanvasTexture {
  let t = footprints.get(shape);
  if (t) return t;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  // An alpha map: white where it's dark. Off-canvas shape, only its blurred shadow kept
  // (works without ctx.filter).
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.shadowOffsetX = s * 2;
  ctx.shadowBlur = 16;
  ctx.shadowColor = '#fff';
  ctx.beginPath();
  if (shape === 'disc') ctx.arc(s / 2 - s * 2, s / 2, s * 0.3, 0, Math.PI * 2);
  else ctx.roundRect(s * 0.2 - s * 2, s * 0.2, s * 0.6, s * 0.6, s * 0.08);
  ctx.fill();
  t = new THREE.CanvasTexture(c);
  footprints.set(shape, t);
  return t;
}

const contactMats = new Map<string, THREE.MeshBasicMaterial>();
function contactMaterial(shape: 'box' | 'disc', opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: '#000000',
    alphaMap: footprint(shape),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
}

/**
 * A contact shadow `w` × `d` metres (the blur reaches a little past it), lying flat at `y`.
 * Furniture shares one material per look; `own` gives it its own (for figures, which free
 * everything they hold).
 */
export function contactShadow(w: number, d: number, shape: 'box' | 'disc', opacity: number, y = 0.004, own = false): THREE.Mesh {
  const key = `${shape}|${opacity}`;
  let mat = own ? undefined : contactMats.get(key);
  if (!mat) {
    mat = contactMaterial(shape, opacity);
    if (!own) {
      mat.userData.shared = true;
      contactMats.set(key, mat);
    }
  }
  // The texture's shape fills its middle 60%: size the quad so the solid part matches w × d.
  const geo = new THREE.PlaneGeometry(w / 0.6, d / 0.6).rotateX(-Math.PI / 2).translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.raycast = () => {};
  return mesh;
}
