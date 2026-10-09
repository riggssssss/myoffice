/**
 * Pictures before they're sent as style references: their real colours, measured from the pixels
 * (so the guide's palette is exact, not guessed), and big photos made smaller so an AI that sees
 * can take them (they accept up to ~3.5 MB).
 */
import type { Swatch } from '../sim/style';

const MAX_EDGE = 2048;
const MAX_BYTES = 3.4 * 1024 * 1024;

async function bitmapOf(file: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/**
 * The main colours (k-means on a small copy, the same answer every time), merged when they're
 * nearly the same, biggest first.
 */
export function paletteOf(bitmap: ImageBitmap, k = 6): Swatch[] {
  const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const px: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]);
  if (!px.length) return [];
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // k-means++ seeding without randomness: each next centre is the pixel farthest from the rest.
  const centres: number[][] = [px[Math.floor(px.length / 2)].slice()];
  while (centres.length < Math.min(k, px.length)) {
    let best = 0;
    let far = -1;
    for (let i = 0; i < px.length; i++) {
      const d = Math.min(...centres.map((c) => d2(px[i], c)));
      if (d > far) (far = d), (best = i);
    }
    if (far <= 0) break;
    centres.push(px[best].slice());
  }
  const owner = new Array<number>(px.length).fill(0);
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0;
      for (let c = 1; c < centres.length; c++) if (d2(px[i], centres[c]) < d2(px[i], centres[best])) best = c;
      owner[i] = best;
    }
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      const s = sum[owner[i]];
      s[0] += px[i][0];
      s[1] += px[i][1];
      s[2] += px[i][2];
      s[3]++;
    }
    sum.forEach((s, c) => s[3] && (centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  const counts = centres.map((_, c) => owner.filter((o) => o === c).length);
  const merged: { rgb: number[]; n: number }[] = [];
  centres
    .map((rgb, c) => ({ rgb, n: counts[c] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .forEach((x) => {
      const hit = merged.find((m) => Math.sqrt(d2(m.rgb, x.rgb)) < 24);
      if (hit) {
        const t = hit.n + x.n;
        hit.rgb = hit.rgb.map((v, i) => (v * hit.n + x.rgb[i] * x.n) / t);
        hit.n = t;
      } else merged.push({ ...x });
    });
  const hex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  return merged
    .sort((a, b) => b.n - a.n)
    .map((m) => ({ hex: hex(m.rgb), share: Math.round((m.n / px.length) * 1000) / 1000 }))
    .filter((s) => s.share >= 0.02)
    .slice(0, 8);
}

/** A picture ready to send as a reference: its colours, and a smaller copy if it's too big. */
export async function prepImage(file: File): Promise<{ file: File; palette: Swatch[] }> {
  if (!file.type.startsWith('image/')) return { file, palette: [] };
  const bitmap = await bitmapOf(file);
  if (!bitmap) return { file, palette: [] };
  const palette = paletteOf(bitmap);
  if (file.size <= MAX_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_EDGE) {
    bitmap.close();
    return { file, palette };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { file: new File([blob], name, { type: 'image/jpeg' }), palette };
}

/** The colours of a picture already sent (for a reference that arrived without them). */
export async function paletteFromBlob(blob: Blob): Promise<Swatch[]> {
  const bitmap = await bitmapOf(blob);
  if (!bitmap) return [];
  const p = paletteOf(bitmap);
  bitmap.close();
  return p;
}
