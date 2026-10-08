import type { SkyKind } from '../sim/layout';
import { apiToken } from '../sim/prefs';

/**
 * The weather as a handful of dials that only ever move gradually: how much of the sky is cloud,
 * how dark it is, how hard it rains, how stormy, how windy. Choosing another sky (or the real
 * weather changing, in «Auto») sets where the dials are heading; they get there over a minute or
 * so, like weather does. The ground gets wet as it rains and dries slowly after; puddles form
 * where it lies lowest and shrink back the same way.
 */
export interface WeatherMix {
  /** Share of the sky that's cloud (0–1). */
  cover: number;
  /** How grey: 0 sunny, 1 dark rain clouds. */
  dark: number;
  /** Rain falling, 0–1. */
  rain: number;
  /** Storm: lightning, gusts. */
  storm: number;
  /** Wind, as a multiple of a light breeze. */
  wind: number;
}

type Fixed = Exclude<SkyKind, 'auto'>;
export const PRESETS: Record<Fixed, WeatherMix> = {
  // A few small clouds: rare, but each one's shade is plain to see as it crosses.
  clear: { cover: 0.2, dark: 0, rain: 0, storm: 0, wind: 1 },
  // Shade spreads and joins up until only the odd gap lets the sun through.
  overcast: { cover: 0.84, dark: 0.45, rain: 0, storm: 0, wind: 1.3 },
  rain: { cover: 0.97, dark: 0.72, rain: 0.6, storm: 0, wind: 1.6 },
  storm: { cover: 1.12, dark: 1, rain: 1, storm: 1, wind: 2.6 },
};

/** Seconds for the dials to get most of the way to a new sky; the clouds gather more slowly, so you see the sky close over. */
const EASE_S = 22;
const COVER_EASE_S = 38;
/** Getting soaked takes a minute or two of rain; drying out, several. */
const WET_S = 70;
const DRY_S = 260;

const KEYS: (keyof WeatherMix)[] = ['cover', 'dark', 'rain', 'storm', 'wind'];

/** What the real weather code means for the dials (WMO codes, as Open-Meteo gives them). */
function fromLive(code: number, cover: number, rainMm: number, windKmh: number): WeatherMix {
  const c = Math.min(1, Math.max(0, cover / 100));
  const wind = Math.min(3, 0.8 + windKmh / 18);
  if (code >= 95) return { ...PRESETS.storm, wind: Math.max(2, wind) };
  // Drizzle, rain, freezing rain, showers: how hard from the code and the millimetres.
  const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  if (rainy) {
    const byCode = [51, 53, 55, 56, 57].includes(code) ? 0.3 : [65, 67, 82].includes(code) ? 0.9 : 0.6;
    const rain = Math.min(1, Math.max(byCode, rainMm / 6));
    return { cover: 0.95 + 0.05 * rain, dark: 0.6 + 0.2 * rain, rain, storm: 0, wind };
  }
  // Fog and snow: a grey, still sky (no snow here).
  if (code === 45 || code === 48 || (code >= 71 && code <= 77) || code === 85 || code === 86) return { ...PRESETS.overcast, wind };
  return { cover: 0.06 + 0.8 * c, dark: Math.max(0, (c - 0.5) / 0.5) * 0.45, rain: 0, storm: 0, wind };
}

const WEATHER_WORDS: [number, string][] = [
  [0, 'despejado'],
  [1, 'casi despejado'],
  [2, 'algo nublado'],
  [3, 'nublado'],
  [48, 'niebla'],
  [57, 'llovizna'],
  [67, 'lluvia'],
  [77, 'nieve'],
  [82, 'chubascos'],
  [86, 'nieve'],
  [99, 'tormenta'],
];
const words = (code: number) => (WEATHER_WORDS.find(([max]) => code <= max) ?? [0, 'despejado'])[1];

/** The real weather, for «Auto»: asked of the local server every 10 minutes while it's in use. */
let live: { mix: WeatherMix; label: string } | null = null;
let liveAsked = 0;
const POLL_MS = 10 * 60_000;

function pollLive(): void {
  const token = apiToken();
  if (!token || Date.now() - liveAsked < POLL_MS) return;
  liveAsked = Date.now();
  fetch('/api/weather', { headers: { 'x-oficina-token': token } })
    .then((r) => r.json())
    .then((w: { code?: number; cover?: number; rain?: number; wind?: number; place?: string; error?: string }) => {
      if (w.error || w.code === undefined) {
        live = live ?? { mix: PRESETS.clear, label: w.error ?? 'Sin datos del tiempo' };
        return;
      }
      live = { mix: fromLive(w.code, w.cover ?? 0, w.rain ?? 0, w.wind ?? 0), label: `${w.place ?? 'Aquí'}: ${words(w.code)}` };
      window.dispatchEvent(new Event('weather-change'));
    })
    .catch(() => {
      // Retry sooner when the server was just restarting.
      liveAsked = Date.now() - POLL_MS + 60_000;
    });
}

/** What «Auto» is showing right now, for the panel (e.g. «Madrid: lluvia»). */
export const liveLabel = (): string | null => live?.label ?? null;

export class Weather {
  /** Where the dials are now. */
  readonly now: WeatherMix = { ...PRESETS.clear };
  /** How wet the ground is (0–1), and how far the puddles have spread (0–1). */
  wet = 0;
  puddles = 0;
  private first = true;
  private startedAt = performance.now();
  private gotLive = false;

  /** The sky chosen, and the seconds since last frame. `instant`: jump there (first frame). */
  update(sky: SkyKind, dt: number): void {
    if (sky === 'auto') pollLive();
    const target = sky === 'auto' ? (live?.mix ?? PRESETS.clear) : PRESETS[sky];
    // Opening the office starts where the sky already is (no rain rolling in on every load):
    // the first frame, or the real weather arriving in the first few seconds.
    let snap = this.first;
    if (sky === 'auto' && live && !this.gotLive) {
      this.gotLive = true;
      snap ||= performance.now() - this.startedAt < 15_000;
    }
    for (const key of KEYS) {
      const k = snap ? 1 : 1 - Math.exp(-dt / (key === 'cover' ? COVER_EASE_S : EASE_S));
      this.now[key] += (target[key] - this.now[key]) * k;
    }
    const soakTo = this.now.rain > 0.05 ? 0.55 + 0.45 * this.now.rain : 0;
    const pudTo = this.now.rain > 0.05 ? 0.35 + 0.65 * Math.max(this.now.storm, (this.now.rain - 0.4) / 0.6) : 0;
    if (snap) {
      this.wet = soakTo;
      this.puddles = pudTo;
    } else {
      // Wetting follows the rain; drying is slow and steady.
      this.wet += soakTo > this.wet ? (soakTo - this.wet) * (1 - Math.exp(-dt / WET_S)) : Math.max(soakTo - this.wet, -dt / DRY_S);
      this.puddles += pudTo > this.puddles ? (pudTo - this.puddles) * (1 - Math.exp(-dt / (WET_S * 1.4))) : Math.max(pudTo - this.puddles, -dt / DRY_S);
    }
    this.first = false;
  }
}

/**
 * Lightning: in a storm, every few seconds a flash (sometimes a double or triple flicker). Gives
 * how bright the extra light is right now, 0–1 (none with reduced motion: thunder only).
 */
export class Lightning {
  private next = 6;
  private pulses: { at: number; len: number; power: number }[] = [];
  private t = 0;
  /** The storm recording sets the strikes (see ambience.ts); otherwise they come at random. */
  external = false;

  /** A strike now, `power` 0–1: one to three flickers. */
  strike(power: number): void {
    const n = 1 + Math.floor(Math.random() * 3);
    let at = this.t;
    for (let i = 0; i < n; i++) {
      const len = 0.06 + Math.random() * 0.12;
      this.pulses.push({ at, len, power: (0.55 + 0.45 * power) * (i ? 0.7 : 1) });
      at += len + 0.05 + Math.random() * 0.12;
    }
  }

  update(dt: number, storm: number, reduced: boolean): number {
    this.t += dt;
    if (storm < 0.4) {
      this.pulses = [];
      this.next = this.t + 4;
      return 0;
    }
    if (this.external) this.next = this.t + 4;
    else if (this.t >= this.next) {
      this.strike(Math.random());
      // Stormier: closer together.
      this.next = this.t + 1 + (5 + Math.random() * 9) / storm;
    }
    // Reduced motion: the thunder still rolls, but no flashing light.
    if (reduced) return 0;
    this.pulses = this.pulses.filter((p) => this.t < p.at + p.len + 0.3);
    let flash = 0;
    for (const p of this.pulses) {
      if (this.t < p.at) continue;
      const u = (this.t - p.at) / p.len;
      // Sharp on, quick fall-off with a short afterglow.
      flash = Math.max(flash, p.power * (u < 1 ? 1 : Math.exp(-(u - 1) * 6)));
    }
    return flash * storm;
  }
}
