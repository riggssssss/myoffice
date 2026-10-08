/**
 * The weather outside right now, for the «Auto» sky: asked of Open-Meteo (free, no account,
 * no key) with only the city's rough position (one decimal: about 10 km) and kept 15 minutes.
 * Nothing else about you leaves this machine.
 */
import { getSettings } from './settings';

export interface LiveWeather {
  /** WMO weather code. */
  code: number;
  /** Share of the sky that's cloud, 0–100. */
  cover: number;
  /** Rain falling now, mm per hour. */
  rain: number;
  /** Wind at 10 m, km/h. */
  wind: number;
  place: string;
  at: number;
}

const KEEP_MS = 15 * 60_000;
let cache: { key: string; value: LiveWeather } | null = null;

export async function liveWeather(): Promise<LiveWeather | { error: string }> {
  const loc = getSettings().location;
  if (!loc) return { error: 'Sin ubicación: ponla en Ajustes.' };
  const lat = loc.lat.toFixed(1);
  const lon = loc.lon.toFixed(1);
  const key = `${lat},${lon}`;
  if (cache && cache.key === key && Date.now() - cache.value.at < KEEP_MS) return cache.value;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,cloud_cover,precipitation,wind_speed_10m`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `El servicio del tiempo respondió ${res.status}` };
    const j = (await res.json()) as { current?: { weather_code?: number; cloud_cover?: number; precipitation?: number; wind_speed_10m?: number } };
    const c = j.current ?? {};
    const value: LiveWeather = {
      code: Number(c.weather_code ?? 0),
      cover: Number(c.cloud_cover ?? 0),
      rain: Number(c.precipitation ?? 0),
      wind: Number(c.wind_speed_10m ?? 0),
      place: loc.place,
      at: Date.now(),
    };
    cache = { key, value };
    return value;
  } catch {
    // Offline: the last one we had, or a clear sky.
    return cache?.value ?? { error: 'Sin conexión para consultar el tiempo.' };
  }
}
