import * as THREE from 'three';
import { WALL_H, type FloorKind, type WallKind } from '../sim/layout';
import { whenWoodLoaded, woodImage, type WoodTone } from './wood';

/**
 * Floor and wall finishes, painted on a canvas so they tile seamlessly. Wooden boards are cut
 * out of a real walnut photo (until it loads, painted grain stands in).
 *
 * Each canvas covers `w` × `h` metres. Floors repeat both ways, over a large enough patch that
 * the repeat doesn't show. Walls are painted the full height of a wall, floor to ceiling, so a
 * wall reads as one piece: they only repeat sideways, never in rows like tiles.
 */

/** The canvas being painted: its size in pixels, and pixels per metre. */
let CW = 1024;
let CH = 1024;
let PPM = 427;

/** How much wood the walnut photo shows across its width, so the grain keeps its real scale. */
const PHOTO_M = 2.4;

function rng(seed: number) {
  seed = (Math.abs(Math.round(seed)) % 2147483646) + 1;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** Draw at (x, y) and again shifted by the canvas size, so shapes crossing an edge wrap around. */
function wrapped(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-CW, 0, CW]) for (const dy of [-CH, 0, CH]) draw(dx, dy);
}

/** Soft round blotch, light or dark, wrapped across the edges. */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, rgba: string): void {
  wrapped((dx, dy) => {
    const cx = x + dx;
    const cy = y + dy;
    if (cx + rad < 0 || cx - rad > CW || cy + rad < 0 || cy - rad > CH) return;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, rgba);
    g.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  });
}

/** One wooden board: real grain along its length (or painted lines), a fine seam around it. */
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
  seam = 0.55,
): void {
  const img = tone ? woodImage(tone) : null;
  if (img) return photoBoard(ctx, r, img, x, y, w, h, alongX, seam);
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
  ctx.restore();
  seamAround(ctx, x, y, w, h, seam);
}

/** The dark joint round a board, thin and soft (a real gap is a millimetre or two). */
function seamAround(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void {
  if (alpha <= 0) return;
  const t = Math.max(1, PPM * 0.002);
  ctx.strokeStyle = `rgba(35,20,8,${alpha})`;
  ctx.lineWidth = t;
  ctx.strokeRect(x + t / 2, y + t / 2, w - t, h - t);
  ctx.strokeStyle = `rgba(35,20,8,${alpha * 0.25})`;
  ctx.lineWidth = t * 2;
  ctx.strokeRect(x + t * 1.5, y + t * 1.5, w - t * 3, h - t * 3);
}

/**
 * A board cut from a random spot of the photo (whose grain runs top to bottom), turned to lie
 * along the board, a little lighter or darker than its neighbours, with a soft bevel and seam.
 * Boards longer than the photo take two cuts, the second mirrored, so the grain carries on.
 */
function photoBoard(ctx: CanvasRenderingContext2D, r: () => number, img: HTMLImageElement, x: number, y: number, w: number, h: number, alongX: boolean, seam: number): void {
  const len = alongX ? w : h;
  const across = alongX ? h : w;
  const scale = img.naturalWidth / (PHOTO_M * PPM);
  const sw = Math.min(img.naturalWidth, across * scale);
  const sx = r() * (img.naturalWidth - sw);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x + w / 2, y + h / 2);
  if (alongX) ctx.rotate(Math.PI / 2);
  // Now and then a board turned end for end, as they come from different logs.
  if (r() < 0.5) ctx.rotate(Math.PI);
  const full = len * scale;
  if (full <= img.naturalHeight) {
    const sy = r() * (img.naturalHeight - full);
    ctx.drawImage(img, sx, sy, sw, full, -across / 2, -len / 2, across, len);
  } else {
    // Bookmatched: the photo, then its mirror, as veneer leaves are laid.
    const part = img.naturalHeight / scale;
    let at = -len / 2;
    for (let i = 0; at < len / 2; i++, at += part) {
      ctx.save();
      if (i % 2) {
        ctx.translate(0, at * 2 + part);
        ctx.scale(1, -1);
      }
      ctx.drawImage(img, sx, 0, sw, img.naturalHeight, -across / 2, at, across, part);
      ctx.restore();
    }
  }
  ctx.restore();
  const k = r() - 0.5;
  ctx.fillStyle = k > 0 ? `rgba(255,240,220,${k * 0.14})` : `rgba(40,22,10,${-k * 0.18})`;
  ctx.fillRect(x, y, w, h);
  // Bevel: a hint of light on one long edge, shade on the other.
  const b = Math.max(1, PPM * 0.004);
  ctx.fillStyle = 'rgba(255,245,230,0.07)';
  if (alongX) ctx.fillRect(x, y + b, w, b);
  else ctx.fillRect(x + b, y, b, h);
  ctx.fillStyle = 'rgba(30,15,5,0.1)';
  if (alongX) ctx.fillRect(x, y + h - 2 * b, w, b);
  else ctx.fillRect(x + w - 2 * b, y, b, h);
  seamAround(ctx, x, y, w, h, seam);
}

/**
 * Plank floor: 20 cm boards between 0.9 and 2.2 m long, as they're really laid. Each row starts
 * at its own offset and its joints stay at least 30 cm from the row before, so no joints line up.
 */
function planks(ctx: CanvasRenderingContext2D, base: [number, number, number], seed: number, tone?: WoodTone): void {
  const r = rng(seed);
  const h = 0.2 * PPM;
  const rows = Math.round(CH / h);
  const rowH = CH / rows;
  const minGap = 0.3 * PPM;
  let prev: number[] = [];
  const mod = (v: number) => ((v % CW) + CW) % CW;
  const near = (a: number, b: number) => Math.min(mod(a - b), mod(b - a)) < minGap;
  for (let row = 0; row < rows; row++) {
    let joints: number[] = [];
    // A layout that keeps clear of the row before (a few tries; the last one stays).
    for (let attempt = 0; attempt < 30; attempt++) {
      const start = r() * CW;
      joints = [start];
      let x = start;
      while (true) {
        const left = start + CW - x;
        const len = (0.9 + r() * 1.3) * PPM;
        if (left - len < 0.6 * PPM) break;
        x += len;
        joints.push(x);
      }
      if (!joints.some((j) => prev.some((p) => near(j, p)))) break;
    }
    prev = joints;
    for (let i = 0; i < joints.length; i++) {
      const bx = joints[i];
      const end = i + 1 < joints.length ? joints[i + 1] : joints[0] + CW;
      wrapped((dx) => board(ctx, rng(seed * 31 + row * 97 + Math.round(bx)), bx + dx, row * rowH, end - bx, rowH, base, true, tone));
    }
  }
}

/** Classic 90° herringbone: boards 4 units long and 1 wide (10 × 40 cm); the pattern repeats every 8 units. */
function herringbone(ctx: CanvasRenderingContext2D, base: [number, number, number], seed: number, tone?: WoodTone): void {
  const u = CW / 8;
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

/** Stone tiles, 60 cm, each its own slab: clouds and faint veins, a fine grout line. */
function tiles(ctx: CanvasRenderingContext2D): void {
  const r = rng(5);
  const s = 0.6 * PPM;
  const n = Math.round(CW / s);
  const size = CW / n;
  const grout = Math.max(2, PPM * 0.003);
  ctx.fillStyle = '#b9b1a3';
  ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = i * size + grout / 2;
      const y0 = j * size + grout / 2;
      const ts = size - grout;
      const k = 0.95 + r() * 0.07;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, ts, ts);
      ctx.clip();
      ctx.fillStyle = `rgb(${[234, 228, 217].map((c) => Math.round(c * k)).join(',')})`;
      ctx.fillRect(x0, y0, ts, ts);
      for (let m = 0; m < 60; m++) {
        const rad = ts * (0.05 + r() * 0.35);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
        const dark = r() < 0.5;
        g.addColorStop(0, dark ? 'rgba(150,138,120,0.07)' : 'rgba(255,253,248,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.translate(x0 + r() * ts, y0 + r() * ts);
        ctx.fillStyle = g;
        ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
        ctx.restore();
      }
      // A few hair veins wandering across the slab.
      for (let v = 0; v < 3; v++) {
        ctx.strokeStyle = `rgba(140,128,110,${0.06 + r() * 0.08})`;
        ctx.lineWidth = 0.6 + r() * 1.2;
        ctx.beginPath();
        let px = x0 + r() * ts;
        let py = y0;
        ctx.moveTo(px, py);
        const steps = 14;
        const drift = (r() - 0.5) * 0.6;
        for (let t = 1; t <= steps; t++) {
          px += (drift + (r() - 0.5) * 0.5) * (ts / steps);
          py += ts / steps;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
      // Edges catch a little light, the grout side a little shade.
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0, y0, ts, 1.5);
      ctx.fillStyle = 'rgba(60,50,40,0.12)';
      ctx.fillRect(x0, y0 + ts - 1.5, ts, 1.5);
    }
  }
  speckle(ctx, r, (CW * CH) / 120, 0.05);
}

/** Microcement: cloudy, with the sweep of the trowel and fine pores. No joints anywhere. */
function concrete(ctx: CanvasRenderingContext2D, base = '#cdc9c2'): void {
  const r = rng(9);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CW, CH);
  const area = (CW * CH) / (1024 * 1024);
  for (let i = 0; i < 260 * area; i++) {
    const light = r() < 0.5;
    const a = 0.025 + r() * 0.045;
    cloud(ctx, r() * CW, r() * CH, (0.15 + r() * 0.8) * PPM, light ? `rgba(240,237,231,${a})` : `rgba(105,100,93,${a})`);
  }
  // Trowel sweeps: wide shallow arcs, slightly glossier or duller than around them.
  for (let i = 0; i < 160 * area; i++) {
    const x = r() * CW;
    const y = r() * CH;
    const rad = (0.25 + r() * 0.6) * PPM;
    const a0 = r() * Math.PI * 2;
    const light = r() < 0.55;
    const alpha = 0.03 + r() * 0.04;
    const width = (0.03 + r() * 0.08) * PPM;
    wrapped((dx, dy) => {
      ctx.strokeStyle = light ? `rgba(250,248,244,${alpha})` : `rgba(95,90,84,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, rad, a0, a0 + 0.5 + r() * 0.9);
      ctx.stroke();
    });
  }
  // Pores.
  for (let i = 0; i < 2200 * area; i++) {
    ctx.fillStyle = `rgba(70,66,60,${0.08 + r() * 0.18})`;
    const s = 0.8 + r() * 1.6;
    ctx.fillRect(r() * CW, r() * CH, s, s);
  }
  speckle(ctx, r, 9000 * area, 0.05);
}

function terrazzo(ctx: CanvasRenderingContext2D): void {
  const r = rng(13);
  ctx.fillStyle = '#ece6da';
  ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 80; i++) cloud(ctx, r() * CW, r() * CH, (0.1 + r() * 0.4) * PPM, r() < 0.5 ? 'rgba(255,252,246,0.05)' : 'rgba(160,150,135,0.05)');
  const chips = ['#c9bfae', '#a89b88', '#7d7468', '#d9a68a', '#9fb0a3', '#e2d6c2', '#5f5a54'];
  const count = Math.round(1400 * ((CW * CH) / (1024 * 1024)));
  for (let i = 0; i < count; i++) {
    const x = r() * CW;
    const y = r() * CH;
    const size = (2 + r() ** 2.4 * 22) * (PPM / 683);
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

/** Carpet: a dense, slightly mottled pile. */
function carpet(ctx: CanvasRenderingContext2D): void {
  const r = rng(17);
  ctx.fillStyle = '#7f8590';
  ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 120; i++) cloud(ctx, r() * CW, r() * CH, (0.1 + r() * 0.3) * PPM, r() < 0.5 ? 'rgba(150,156,166,0.08)' : 'rgba(80,84,92,0.08)');
  speckle(ctx, r, (CW * CH) / 14, 0.22);
}

/** Fine dots, light and dark, for fibre or grit. */
function speckle(ctx: CanvasRenderingContext2D, r: () => number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * CW, r() * CH, 1.5, 1.5);
  }
}

interface FinishDef {
  /** Metres one canvas covers, across and up (for walls, `h` is the wall's height). */
  w: number;
  h: number;
  /** Pixels across. */
  px: number;
  paint: (ctx: CanvasRenderingContext2D) => void;
  /** Relief from the picture itself (seams, grain, grout); 0 for none. */
  bump?: number;
}

const DEFS: Record<Exclude<FloorKind, 'plain'>, FinishDef> = {
  oak: { w: 4.8, h: 4.8, px: 2048, bump: 0.6, paint: (c) => planks(c, [214, 178, 132], 3, 'honey') },
  walnut: { w: 4.8, h: 4.8, px: 2048, bump: 0.6, paint: (c) => planks(c, [128, 88, 62], 7, 'natural') },
  walnutRed: { w: 4.8, h: 4.8, px: 2048, bump: 0.6, paint: (c) => planks(c, [120, 62, 30], 19, 'red') },
  smoked: { w: 4.8, h: 4.8, px: 2048, bump: 0.6, paint: (c) => planks(c, [140, 108, 92], 23, 'smoked') },
  ebony: { w: 4.8, h: 4.8, px: 2048, bump: 0.5, paint: (c) => planks(c, [48, 42, 38], 31, 'dark') },
  herringbone: { w: 3.2, h: 3.2, px: 2048, bump: 0.6, paint: (c) => herringbone(c, [206, 168, 120], 11, 'honey') },
  herringboneSmoked: { w: 3.2, h: 3.2, px: 2048, bump: 0.6, paint: (c) => herringbone(c, [140, 108, 92], 37, 'smoked') },
  tiles: { w: 2.4, h: 2.4, px: 2048, bump: 0.8, paint: tiles },
  concrete: { w: 4, h: 4, px: 2048, bump: 0.25, paint: (c) => concrete(c) },
  terrazzo: { w: 2, h: 2, px: 1536, bump: 0.15, paint: terrazzo },
  carpet: { w: 1.5, h: 1.5, px: 1024, bump: 1.2, paint: carpet },
};

// ---------------------------------------------------------------- walls

/** Vertical slats with dark shadow gaps, like an acoustic wall panel, floor to ceiling. */
function slats(ctx: CanvasRenderingContext2D, tone: WoodTone, base: [number, number, number]): void {
  ctx.fillStyle = '#2a1f17';
  ctx.fillRect(0, 0, CW, CH);
  const n = Math.round(CW / (0.075 * PPM)); // 7.5 cm slats
  const w = CW / n;
  const gap = Math.max(3, 0.012 * PPM);
  for (let i = 0; i < n; i++) board(ctx, rng(400 + i), i * w + gap / 2, 0, w - gap, CH, base, false, tone, 0.25);
}

/** Tall veneered panels, 60 cm wide and the full height of the wall, a fine shadow joint between. */
function panels(ctx: CanvasRenderingContext2D, tone: WoodTone, base: [number, number, number]): void {
  ctx.fillStyle = '#2a1f17';
  ctx.fillRect(0, 0, CW, CH);
  const n = Math.round(CW / (0.6 * PPM));
  const w = CW / n;
  const gap = Math.max(2, 0.004 * PPM);
  for (let i = 0; i < n; i++) board(ctx, rng(500 + i * 13), i * w + gap / 2, 0, w - gap, CH, base, false, tone, 0.2);
}

/** Running-bond brick (24 × 7 cm, 1 cm joints), painted off-white, each brick a touch different. */
function brick(ctx: CanvasRenderingContext2D): void {
  const r = rng(21);
  ctx.fillStyle = '#c9c3b8';
  ctx.fillRect(0, 0, CW, CH);
  const rows = Math.round(CH / (0.08 * PPM));
  const h = CH / rows;
  const per = Math.round(CW / (0.25 * PPM));
  const w = CW / per;
  const joint = Math.max(2, 0.01 * PPM);
  for (let row = 0; row < rows; row++) {
    const shift = row % 2 ? w / 2 : 0;
    for (let i = -1; i <= per; i++) {
      const k = 0.93 + r() * 0.09;
      ctx.fillStyle = `rgb(${[240, 236, 228].map((c) => Math.round(c * k)).join(',')})`;
      ctx.fillRect(i * w + shift + joint / 2, row * h + joint / 2, w - joint, h - joint);
    }
  }
  for (let i = 0; i < 90; i++) cloud(ctx, r() * CW, r() * CH, (0.2 + r() * 0.6) * PPM, r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(150,140,125,0.05)');
  speckle(ctx, r, (CW * CH) / 90, 0.08);
}

/** Wallpaper: wide cream stripes with a thin muted line between, floor to ceiling. */
function stripes(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#efe8da';
  ctx.fillRect(0, 0, CW, CH);
  const n = Math.round(CW / (0.15 * PPM));
  const w = CW / n;
  for (let i = 0; i < n; i++) {
    if (i % 2) {
      ctx.fillStyle = '#e2d6c0';
      ctx.fillRect(i * w, 0, w, CH);
    }
    ctx.fillStyle = 'rgba(150,125,95,0.35)';
    ctx.fillRect(i * w - 1, 0, 2, CH);
  }
  speckle(ctx, rng(29), (CW * CH) / 170, 0.05);
}

/** Lime wash: warm white laid on with a wide brush, cloudy and soft, one piece wall to wall. */
function limewash(ctx: CanvasRenderingContext2D): void {
  const r = rng(41);
  ctx.fillStyle = '#ece5d8';
  ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 220; i++) cloud(ctx, r() * CW, r() * CH, (0.2 + r() * 0.9) * PPM, r() < 0.5 ? 'rgba(255,252,245,0.06)' : 'rgba(176,162,140,0.06)');
  // Brush strokes in every direction, broad and faint.
  for (let i = 0; i < 700; i++) {
    const x = r() * CW;
    const y = r() * CH;
    const len = (0.15 + r() * 0.5) * PPM;
    const ang = r() * Math.PI;
    const light = r() < 0.5;
    const alpha = 0.02 + r() * 0.035;
    const width = (0.04 + r() * 0.1) * PPM;
    const bend = (r() - 0.5) * len * 0.5;
    wrapped((dx, dy) => {
      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.rotate(ang);
      ctx.strokeStyle = light ? `rgba(255,253,248,${alpha})` : `rgba(150,136,115,${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.quadraticCurveTo(0, bend, len / 2, 0);
      ctx.stroke();
      ctx.restore();
    });
  }
  speckle(ctx, r, (CW * CH) / 160, 0.04);
}

const WALL_DEFS: Partial<Record<WallKind, FinishDef>> = {
  slats: { w: 1.2, h: WALL_H, px: 640, paint: (c) => slats(c, 'honey', [196, 156, 110]) },
  slatsDark: { w: 1.2, h: WALL_H, px: 640, paint: (c) => slats(c, 'dark', [52, 45, 40]) },
  panelNatural: { w: 2.4, h: WALL_H, px: 1024, paint: (c) => panels(c, 'natural', [128, 88, 62]) },
  panelSmoked: { w: 2.4, h: WALL_H, px: 1024, paint: (c) => panels(c, 'smoked', [140, 108, 92]) },
  panelRed: { w: 2.4, h: WALL_H, px: 1024, paint: (c) => panels(c, 'red', [120, 62, 30]) },
  brick: { w: 2.4, h: WALL_H, px: 1024, paint: brick },
  concrete: { w: 4, h: WALL_H, px: 1536, paint: (c) => concrete(c, '#d2cec7') },
  stripes: { w: 1.2, h: WALL_H, px: 512, paint: stripes },
  limewash: { w: 4, h: WALL_H, px: 1280, paint: limewash },
};

/** Plain paint colours (no texture). */
export const WALL_PAINT: Partial<Record<WallKind, string>> = {
  sage: '#b7c2a8',
  terracotta: '#d6a184',
  mist: '#b9c6d1',
};

// ---------------------------------------------------------------- shared

const canvases = new Map<string, { canvas: HTMLCanvasElement; def: FinishDef }>();

function paintInto(canvas: HTMLCanvasElement, def: FinishDef): void {
  CW = canvas.width;
  CH = canvas.height;
  PPM = CW / def.w;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, CW, CH);
  def.paint(ctx);
}

function paintCanvas(key: string, def: FinishDef): HTMLCanvasElement {
  let c = canvases.get(key);
  if (!c) {
    const canvas = document.createElement('canvas');
    canvas.width = def.px;
    canvas.height = Math.round((def.px * def.h) / def.w);
    paintInto(canvas, def);
    canvases.set(key, (c = { canvas, def }));
  }
  return c.canvas;
}

// Once the wood photos are in, everything painted before then is painted again with them.
whenWoodLoaded(() => {
  for (const { canvas, def } of canvases.values()) paintInto(canvas, def);
  for (const t of [...textures.values(), ...wallTextures.values()]) t.needsUpdate = true;
  thumbs.clear();
  wallThumbs.clear();
});
const canvasFor = (kind: Exclude<FloorKind, 'plain'>) => paintCanvas(`floor:${kind}`, DEFS[kind]);

/** A square of about `m` metres from the corner of the canvas, so the preview shows the real scale. */
function thumbOf(c: HTMLCanvasElement, def: FinishDef, m = 1.6): string {
  const t = document.createElement('canvas');
  t.width = t.height = 96;
  const side = Math.min(c.width, c.height, (c.width / def.w) * m);
  t.getContext('2d')!.drawImage(c, 0, c.height - side, side, side, 0, 0, 96, 96);
  return t.toDataURL('image/jpeg', 0.8);
}

const wallTextures = new Map<WallKind, THREE.CanvasTexture>();

/**
 * Texture for walls whose UVs are in metres from the floor (see Office), or null for paint and
 * plain. One copy runs the whole height of the wall and repeats only along it.
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
    t.repeat.set(1 / def.w, 1 / def.h);
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
    url = thumbOf(paintCanvas(`wall:${kind}`, def), def);
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
  t.repeat.set(1 / DEFS[kind].w, 1 / DEFS[kind].h);
  return t;
}

/** How much relief a floor takes from its own picture (seams, grout, pile). */
export const floorBump = (kind: FloorKind): number => (kind === 'plain' ? 0 : (DEFS[kind].bump ?? 0));

/** Small square preview for the editor's picker. */
const thumbs = new Map<FloorKind, string>();
export function floorThumb(kind: FloorKind): string | null {
  if (kind === 'plain') return null;
  let url = thumbs.get(kind);
  if (!url) {
    url = thumbOf(canvasFor(kind), DEFS[kind]);
    thumbs.set(kind, url);
  }
  return url;
}
