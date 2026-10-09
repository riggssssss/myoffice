/** Office-wide preferences that aren't secrets. */
import { DEFAULT_SETTINGS, IMAGE_QUALITY, isProvider, MAX_CHAIN, PROVIDERS, validModel, type AiChoice, type ImageProvider, type Settings } from '../src/sim/settings';
import { getJson, setJson } from './db';

export function getSettings(): Settings {
  const s = getJson<Partial<Settings>>('settings') ?? {};
  const ai = { ...DEFAULT_SETTINGS.ai, ...s.ai };
  // Saved before there was a priority list: the AI you had is the first (and only) one.
  if (!s.ai?.chain?.length) ai.chain = [{ provider: ai.provider, model: ai.model }];
  ai.provider = ai.chain[0].provider;
  ai.model = ai.chain[0].model;
  return { ...DEFAULT_SETTINGS, ...s, ai, image: { ...DEFAULT_SETTINGS.image, ...s.image } };
}

/** A priority list from the browser: valid entries only, no repeats, at least one. */
function cleanChain(v: unknown): AiChoice[] | null {
  if (!Array.isArray(v)) return null;
  const out: AiChoice[] = [];
  for (const c of v.slice(0, MAX_CHAIN)) {
    const provider = (c as AiChoice)?.provider;
    const model = typeof (c as AiChoice)?.model === 'string' ? (c as AiChoice).model.trim() : '';
    if (!isProvider(provider) || !validModel(provider, model)) return null;
    if (!out.some((x) => x.provider === provider && x.model === model)) out.push({ provider, model });
  }
  return out.length ? out : null;
}

const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const IMAGES: ImageProvider[] = ['none', 'fal', 'recraft', 'cloudflare'];
/** Ollama runs on this machine (or one you name): an http(s) address, nothing else. */
const validUrl = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 200) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Applies the valid parts of a patch from the browser; returns the result. */
export function patchSettings(patch: unknown): Settings {
  const next = getSettings();
  const p = (patch ?? {}) as Partial<Settings>;
  if (p.location === null) next.location = null;
  else if (p.location && num(p.location.lat, -90, 90) && num(p.location.lon, -180, 180)) {
    next.location = {
      lat: p.location.lat,
      lon: p.location.lon,
      place: typeof p.location.place === 'string' ? p.location.place.slice(0, 80) : '',
      guessed: p.location.guessed === true,
    };
  }
  if (num(p.north, -360, 360)) next.north = p.north;
  if (typeof p.sofaColor === 'string' && /^#[0-9a-f]{6}$/i.test(p.sofaColor)) next.sofaColor = p.sofaColor.toLowerCase();
  if (p.ai) {
    let model = typeof p.ai.model === 'string' ? p.ai.model.trim() : null;
    if (isProvider(p.ai.provider) && p.ai.provider !== next.ai.provider) {
      // Another provider starts on its usual model; the old provider's model doesn't carry over.
      if (model === next.ai.model) model = null;
      next.ai.provider = p.ai.provider;
      next.ai.model = PROVIDERS[p.ai.provider].defaultModel;
    }
    if (validModel(next.ai.provider, model)) next.ai.model = model;
    // Changing "the" provider or model changes the first of the list.
    next.ai.chain = [{ provider: next.ai.provider, model: next.ai.model }, ...next.ai.chain.slice(1)].filter(
      (c, i, all) => all.findIndex((x) => x.provider === c.provider && x.model === c.model) === i,
    );
    const chain = cleanChain(p.ai.chain);
    if (chain) {
      next.ai.chain = chain;
      next.ai.provider = chain[0].provider;
      next.ai.model = chain[0].model;
    }
    if (validUrl(p.ai.ollamaUrl)) next.ai.ollamaUrl = p.ai.ollamaUrl;
    const daily = Number(p.ai.dailyTokens);
    // 0: no cap at all (free plans like NVIDIA's have their own limits anyway).
    if (daily === 0 || num(daily, 10_000, 50_000_000)) next.ai.dailyTokens = Math.round(daily);
    const pace = Number(p.ai.workPerHour);
    if ('workPerHour' in p.ai && (pace === 0 || num(pace, 6, 240))) next.ai.workPerHour = Math.round(pace);
    const terse = p.ai.terse as unknown;
    if (terse === true || terse === 'true') next.ai.terse = true;
    else if (terse === false || terse === 'false') next.ai.terse = false;
  }
  if (p.image && IMAGES.includes(p.image.provider)) next.image.provider = p.image.provider;
  if (p.image && IMAGE_QUALITY.some((q) => q.id === p.image!.quality)) next.image.quality = p.image.quality;
  if (p.image && 'dailyUsd' in p.image) {
    const usd = Number(p.image.dailyUsd);
    if (usd === 0 || num(usd, 0.01, 50)) next.image.dailyUsd = Math.round(usd * 100) / 100;
  }
  setJson('settings', next);
  return next;
}
