import * as THREE from 'three';
import type { FloorKind, WallKind } from '../sim/layout';
import { whenWoodLoaded, woodImage, type WoodTone } from './wood';

/**
 * Floor and wall finishes, painted on a canvas so they tile seamlessly. Wooden boards are cut
 * out of a real walnut photo (until it loads, painted grain stands in).
 * Each canvas covers `size` metres; the texture repeats across the surface.
 */
const PX = 1024;

function rng(seed: number) {
  seed = (Math.abs(Math.round(seed)) % 2147483646) + 1;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Draw at (x, y) and again shifted by the canvas size, so shapes crossing an edge wrap around. */
function wrapped(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-PX, 0, PX]) for (const dy of [-PX, 0, PX]) draw(dx, dy);
}

/** One wooden board: real grain along its length (or painted lines), darker seam around it. */
function board(
  ctx: CanvasRenderingContext2D,
  r: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  base: [number, number, number],
  alongX: boolean,
  tone?: WoodTone,
): void {
  const img = tone ? woodImage(tone) : null;
  if (img) return photoBoard(ctx, r, img, x, y, w, h, alongX);
  const k = 0.88 + r() * 0.22;
  ctx.fillStyle = `rgb(${base.map((c) => Math.min(255, Math.round(c * k))).join(',')})`;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const len = alongX ? w : h;
  const across = alongX ? h : w;
  const lines = Math.round(across / 3);
  for (let i = 0; i < lines; i++) {
    const off = (i + r()) * (across / lines);
    const amp = 0.6 + r() * 2.2;
    const freq = 0.004 + r() * 0.01;
    const phase = r() * 10;
    ctx.strokeStyle = `rgba(70,40,15,${0.04 + r() * 0.09})`;
    ctx.lineWidth = 0.6 + r() * 1.2;
    ctx.beginPath();
    for (let t = 0; t <= len; t += 8) {
      const o = off + Math.sin(t * freq + phase) * amp;
      const px = alongX ? x + t : x + o;
      const py = alongX ? y + o : y + t;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Now and then a knot.
  if (r() < 0.25) {
    const cx = alongX ? x + r() * w : x + w / 2;
    const cy = alongX ? y + h / 2 : y + r() * h;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, across * 0.35);
    g.addColorStop(0, 'rgba(80,45,20,0.35)');
    g.addColorStop(1, 'rgba(80,45,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(60,35,15,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

/**
 * A board cut from a random spot of the photo (whose grain runs top to bottom), turned to lie
 * along the board, a little lighter or darker than its neighbours, with a soft bevel and seam.
 * The photo spans about as much wood as one canvas, so the grain keeps its real scale.
 */
function photoBoard(ctx: CanvasRenderingContext2D, r: () => number, img: HTMLImageElement, x: number, y: number, w: number, h: number, alongX: boolean): void {
  const len = alongX ? w : h;
  const across = alongX ? h : w;
  const scale = img.naturalWidth / PX;
  const sw = Math.min(img.naturalWidth, across * scale);
  const sh = Math.min(img.naturalHeight, len * scale);
  const sx = r() * (img.naturalWidth - sw);
  const sy = r() * (img.naturalHeight - sh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w / 2, y + h / 2);
  if (alongX) ctx.rotate(Math.PI / 2);
  // Now and then a board turned end for end, as they come from different logs.
  if (r() < 0.5) ctx.rotate(Math.PI);
  ctx.drawImage(img, sx, sy, sw, sh, -across / 2, -len / 2, across, len);
  ctx.restore();
  const k = r() - 0.5;
  ctx.fillStyle = k > 0 ? `rgba(255,240,220,${k * 0.16})` : `rgba(40,22,10,${-k * 0.2})`;
  ctx.fillRect(x, y, w, h);
  // Bevel: a hint of light on one long edge, shade on the other.
  ctx.fillStyle = 'rgba(255,245,230,0.08)';
  if (alongX) ctx.fillRect(x, y + 2, w, 3);
  else ctx.fillRect(x + 2, y, 3, h);
  ctx.fillStyle = 'rgba(30,15,5,0.12)';
  if (alongX) ctx.fillRect(x, y + h - 5, w, 3);
  else ctx.fillRect(x + w - 5, y, 3, h);
  ctx.strokeStyle = 'rgba(35,20,8,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function planks(ctx: CanvasRenderingContext2D, base: [number, number, number], seed: number, tone?: WoodTone): void {
  const r = rng(seed);
  const rows = 12; // 20 cm boards over 2.4 m
  const h = PX / rows;
  for (let row = 0; row < rows; row++) {
    // Each row's boards add up to exactly one tile width, starting at a random offset;
    // boards that run past the right edge reappear on the left, so the tile is seamless.
    const start = -r() * PX;
    let x = start;
    while (x < start + PX - 1) {
      const w = Math.min(PX * (0.33 + r() * 0.5), start + PX - x);
      const bx = x;
      wrapped((dx) => board(ctx, rng(seed * 31 + row * 97 + Math.round(bx)), bx + dx, row * h, w, h, base, true, tone));
      x += w;
    }
  }
}

/** Classic 90° herringbone: boards 4 units long and 1 wide; the pattern repeats every 8 units. */
function herringbone(ctx: CanvasRenderingContext2D, base: [number, number, number], seed: number, tone?: WoodTone): void {
  const u = PX / 8;
  const mod = (v: number) => ((v % 8) + 8) % 8;
  for (let a = -12; a < 12; a++) {
    for (let b = -4; b < 4; b++) {
      // Lattice generated by (1, 1) and (4, -4).
      const ox = a + b * 4;
      const oy = a - b * 4;
      // Same board on both sides of a tile edge: seed by position within the repeat.
      const key = seed + mod(ox) * 131 + mod(oy) * 7;
      board(ctx, rng(key), ox * u, oy * u, 4 * u, u, base, true, tone);
      board(ctx, rng(key + 1), (ox - 1) * u, oy * u, u, 4 * u, base, false, tone);
    }
  }
}

function tiles(ctx: CanvasRenderingContext2D): void {
  const r = rng(5);
  const n = 2; // 60 cm tiles over 1.2 m
  const s = PX / n;
  ctx.fillStyle = '#cfc8bb';
  ctx.fillRect(0, 0, PX, PX);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = 0.96 + r() * 0.06;
      ctx.fillStyle = `rgb(${[236, 231, 222].map((c) => Math.round(c * k)).join(',')})`;
      ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      // Soft stone mottling.
      for (let m = 0; m < 40; m++) {
        const x = i * s + 3 + r() * (s - 6);
        const y = j * s + 3 + r() * (s - 6);
        const rad = 10 + r() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const dark = r() < 0.5;
        g.addColorStop(0, dark ? 'rgba(150,140,125,0.08)' : 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(Math.max(i * s + 3, x - rad), Math.max(j * s + 3, y - rad), rad * 2, rad * 2);
      }
    }
  }
}

function concrete(ctx: CanvasRenderingContext2D): void {
  const r = rng(9);
  ctx.fillStyle = '#cdc9c2';
  ctx.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 260; i++) {
    const x = r() * PX;
    const y = r() * PX;
    const rad = 40 + r() * 220;
    const light = r() < 0.5;
    const a = 0.02 + r() * 0.04;
    wrapped((dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      g.addColorStop(0, light ? `rgba(235,232,226,${a})` : `rgba(110,105,98,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  speckle(ctx, r, 9000, 0.06);
}

function terrazzo(ctx: CanvasRenderingContext2D): void {
  const r = rng(13);
  ctx.fillStyle = '#ece6da';
  ctx.fillRect(0, 0, PX, PX);
  const chips = ['#c9bfae', '#a89b88', '#7d7468', '#d9a68a', '#9fb0a3', '#e2d6c2', '#5f5a54'];
  for (let i = 0; i < 1400; i++) {
    const x = r() * PX;
    const y = r() * PX;
    const size = 2 + r() ** 2.4 * 22;
    const color = chips[Math.floor(r() * chips.length)];
    const sides = 4 + Math.floor(r() * 3);
    const rot = r() * Math.PI;
    const pts = Array.from({ length: sides }, (_, k) => {
      const a = rot + (k / sides) * Math.PI * 2;
      const rr = size * (0.6 + r() * 0.5);
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    });
    wrapped((dx, dy) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(x + dx + px, y + dy + py) : ctx.moveTo(x + dx + px, y + dy + py)));
      ctx.fill();
    });
  }
}

function carpet(ctx: CanvasRenderingContext2D): void {
  const r = rng(17);
  ctx.fillStyle = '#7f8590';
  ctx.fillRect(0, 0, PX, PX);
  speckle(ctx, r, 60000, 0.22);
}

/** Fine dots, light and dark, for fibre or grit. */
function speckle(ctx: CanvasRenderingContext2D, r: () => number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * PX, r() * PX, 1.5, 1.5);
  }
}

interface FloorDef {
  /** Metres of floor one canvas covers. */
  size: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
}

const DEFS: Record<Exclude<FloorKind, 'plain'>, FloorDef> = {
  oak: { size: 2.4, paint: (c) => planks(c, [214, 178, 132], 3, 'honey') },
  walnut: { size: 2.4, paint: (c) => planks(c, [128, 88, 62], 7, 'natural') },
  walnutRed: { size: 2.4, paint: (c) => planks(c, [120, 62, 30], 19, 'red') },
  smoked: { size: 2.4, paint: (c) => planks(c, [140, 108, 92], 23, 'smoked') },
  ebony: { size: 2.4, paint: (c) => planks(c, [48, 42, 38], 31, 'dark') },
  herringbone: { size: 1.6, paint: (c) => herringbone(c, [206, 168, 120], 11, 'honey') },
  herringboneSmoked: { size: 1.6, paint: (c) => herringbone(c, [140, 108, 92], 37, 'smoked') },
  tiles: { size: 1.2, paint: tiles },
  concrete: { size: 3, paint: concrete },
  terrazzo: { size: 1.5, paint: terrazzo },
  carpet: { size: 1, paint: carpet },
};

// ---------------------------------------------------------------- walls

/** Vertical slats with dark shadow gaps, like an acoustic wall panel. */
function slats(ctx: CanvasRenderingContext2D, tone: WoodTone, base: [number, number, number]): void {
  ctx.fillStyle = '#2a1f17';
  ctx.fillRect(0, 0, PX, PX);
  const n = 16; // 7.5 cm slats over 1.2 m
  const w = PX / n;
  for (let i = 0; i < n; i++) board(ctx, rng(400 + i), i * w + 4, 0, w - 8, PX, base, false, tone);
}

/** Tall veneered panels, 60 cm wide, with a fine shadow joint between them. */
function panels(ctx: CanvasRenderingContext2D, tone: WoodTone, base: [number, number, number]): void {
  ctx.fillStyle = '#2a1f17';
  ctx.fillRect(0, 0, PX, PX);
  const n = 2; // 60 cm panels over 1.2 m
  const w = PX / n;
  for (let i = 0; i < n; i++) board(ctx, rng(500 + i * 13), i * w + 1, 0, w - 2, PX, base, false, tone);
}

/** Running-bond brick, painted off-white. */
function brick(ctx: CanvasRenderingContext2D): void {
  const r = rng(21);
  ctx.fillStyle = '#c9c3b8';
  ctx.fillRect(0, 0, PX, PX);
  const rows = 14;
  const h = PX / rows;
  const w = PX / 4;
  for (let row = 0; row < rows; row++) {
    const shift = row % 2 ? w / 2 : 0;
    for (let i = -1; i < 5; i++) {
      const k = 0.94 + r() * 0.08;
      ctx.fillStyle = `rgb(${[240, 236, 228].map((c) => Math.round(c * k)).join(',')})`;
      ctx.fillRect(i * w + shift + 3, row * h + 3, w - 6, h - 6);
    }
  }
  speckle(ctx, r, 8000, 0.08);
}

/** Wallpaper: wide cream stripes with a thin muted line between. */
function stripes(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#efe8da';
  ctx.fillRect(0, 0, PX, PX);
  const n = 8;
  const w = PX / n;
  for (let i = 0; i < n; i++) {
    if (i % 2) {
      ctx.fillStyle = '#e2d6c0';
      ctx.fillRect(i * w, 0, w, PX);
    }
    ctx.fillStyle = 'rgba(150,125,95,0.35)';
    ctx.fillRect(i * w - 1, 0, 2, PX);
  }
  speckle(ctx, rng(29), 6000, 0.05);
}

const WALL_DEFS: Partial<Record<WallKind, FloorDef>> = {
  slats: { size: 1.2, paint: (c) => slats(c, 'honey', [196, 156, 110]) },
  slatsDark: { size: 1.2, paint: (c) => slats(c, 'dark', [52, 45, 40]) },
  panelNatural: { size: 1.2, paint: (c) => panels(c, 'natural', [128, 88, 62]) },
  panelSmoked: { size: 1.2, paint: (c) => panels(c, 'smoked', [140, 108, 92]) },
  panelRed: { size: 1.2, paint: (c) => panels(c, 'red', [120, 62, 30]) },
  brick: { size: 1.0, paint: brick },
  concrete: { size: 3, paint: concrete },
  stripes: { size: 1.2, paint: stripes },
};

/** Plain paint colours (no texture). */
export const WALL_PAINT: Partial<Record<WallKind, string>> = {
  sage: '#b7c2a8',
  terracotta: '#d6a184',
  mist: '#b9c6d1',
};

// ---------------------------------------------------------------- shared

const canvases = new Map<string, { canvas: HTMLCanvasElement; def: FloorDef }>();
function paintCanvas(key: string, def: FloorDef): HTMLCanvasElement {
  let c = canvases.get(key);
  if (!c) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PX;
    def.paint(canvas.getContext('2d')!);
    canvases.set(key, (c = { canvas, def }));
  }
  return c.canvas;
}

// Once the wood photos are in, everything painted before then is painted again with them.
whenWoodLoaded(() => {
  for (const { canvas, def } of canvases.values()) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, PX, PX);
    def.paint(ctx);
  }
  for (const t of [...textures.values(), ...wallTextures.values()]) t.needsUpdate = true;
  thumbs.clear();
  wallThumbs.clear();
});
const canvasFor = (kind: Exclude<FloorKind, 'plain'>) => paintCanvas(`floor:${kind}`, DEFS[kind]);

function thumbOf(c: HTMLCanvasElement): string {
  const t = document.createElement('canvas');
  t.width = t.height = 96;
  t.getContext('2d')!.drawImage(c, 0, 0, 96, 96);
  return t.toDataURL('image/jpeg', 0.8);
}

const wallTextures = new Map<WallKind, THREE.CanvasTexture>();

/**
 * Texture for walls whose UVs are in metres (see Office), or null for paint and plain.
 * Repeat is 1 / tile size, so one texture serves walls of any length.
 */
export function wallTexture(kind: WallKind): THREE.CanvasTexture | null {
  const def = WALL_DEFS[kind];
  if (!def) return null;
  let t = wallTextures.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(paintCanvas(`wall:${kind}`, def));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(1 / def.size, 1 / def.size);
    wallTextures.set(kind, t);
  }
  return t;
}

const wallThumbs = new Map<WallKind, string>();
export function wallThumb(kind: WallKind): string | null {
  const def = WALL_DEFS[kind];
  if (!def) return null;
  let url = wallThumbs.get(kind);
  if (!url) {
    url = thumbOf(paintCanvas(`wall:${kind}`, def));
    wallThumbs.set(kind, url);
  }
  return url;
}

const textures = new Map<FloorKind, THREE.CanvasTexture>();

/** Texture for floors whose UVs are in metres (see Office), or null for the plain floor. */
export function floorTexture(kind: FloorKind): THREE.CanvasTexture | null {
  if (kind === 'plain') return null;
  let t = textures.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(canvasFor(kind));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    textures.set(kind, t);
  }
  t.repeat.set(1 / DEFS[kind].size, 1 / DEFS[kind].size);
  return t;
}

/** Small square preview for the editor's picker. */
const thumbs = new Map<FloorKind, string>();
export function floorThumb(kind: FloorKind): string | null {
  if (kind === 'plain') return null;
  let url = thumbs.get(kind);
  if (!url) {
    url = thumbOf(canvasFor(kind));
    thumbs.set(kind, url);
  }
  return url;
}
