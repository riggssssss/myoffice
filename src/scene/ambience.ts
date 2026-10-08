/**
 * The sound outside, following the weather: birds on a fine day (a little quieter under grey
 * skies, silent as the rain starts and at night), wind far in the background when it clouds
 * over, rain that swells and fades with how hard it's raining, and in a storm a thunderstorm
 * recording on top of the rain. The lightning follows that recording: each flash
 * comes a moment before a thunderclap in it, as light outruns sound. Every layer fades in and
 * out as gradually as the weather. Under it all, the office's song on a loop. Silent until you first touch the page (browsers ask for that)
 * and whenever you switch it off; it pauses with the tab in the background.
 */
const KEY = 'oficina-3d:sound';
const url = (name: string) => `${import.meta.env.BASE_URL}sounds/${name}.m4a`;
/** Seconds the loop's end is blended into its start, so it never clicks. */
const SEAM_S = 3;
/**
 * Each layer's full level. The recordings were measured (birds −26, rain −22, storm −28, wind −24
 * LUFS) and set so the mix sits at: birds −34 on a fine day, wind −40 (well behind the birds),
 * rain −29 when it pours, the storm −28 on top of the rain.
 */
const VOLUME = { birds: 0.39, wind: 0.155, rain: 0.45, storm: 1 };
/**
 * The song (−15.7 LUFS, brought down to about −30: present, never in the way). It plays its
 * intro once, then loops a 72-bar stretch whose two ends were matched beat for beat, with the
 * last bar before the end already blended into the bar before the start (found and baked offline from
 * the original track): no gap, no stumble in the rhythm.
 */
const MUSIC = { url: 'music', volume: 0.19, loopStart: 44.77, loopEnd: 176.7521 };
/**
 * People talking: a recording of babble (−17 LUFS, brought down to about −37, just under the birds),
 * never played straight through. Each line someone says is a run of short snippets picked at
 * random from all over it, each eased in and out, at that person's own pitch: it sounds like
 * talk, never the same twice, and nobody hears the recording loop.
 */
const VOICES = { url: 'voices', volume: 0.1 };
/** Seconds of talk for a line of `n` characters. */
const talkFor = (n: number) => Math.min(4, 0.7 + n * 0.03);

/** Seconds each layer takes to settle at a new level (on top of the weather's own easing). */
const FADE_S = 1.5;
/** Coming in (page opened, tab back, sound switched on): a slow fade, never a jolt. */
const IN_S = 1.2;
const OUT_S = 0.25;

type Layer = keyof typeof VOLUME;

let on = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export const soundOn = () => on;
export function setSoundOn(next: boolean): void {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    /* blocked storage: it just isn't remembered */
  }
  if (next) ambience.wake();
  ambience.refresh();
  for (const fn of listeners) fn();
}
export function onSoundChange(fn: () => void): void {
  listeners.add(fn);
}

/** A loop whose last seconds fade into its first: no seam when it wraps round. */
function seamless(ctx: AudioContext, b: AudioBuffer): AudioBuffer {
  const seam = Math.min(Math.floor(SEAM_S * b.sampleRate), Math.floor(b.length / 4));
  const len = b.length - seam;
  const out = ctx.createBuffer(b.numberOfChannels, len, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < seam; i++) {
      // Equal-power: the head comes in as the tail goes out.
      const t = i / seam;
      dst[i] = src[i] * Math.sin((t * Math.PI) / 2) + src[len + i] * Math.cos((t * Math.PI) / 2);
    }
  }
  return out;
}

/** Where the thunderclaps are in a recording (seconds) and how loud (0–1). */
function findStrikes(b: AudioBuffer): { at: number; power: number }[] {
  const win = Math.floor(b.sampleRate * 0.05);
  const n = Math.floor(b.length / win);
  const rms = new Float32Array(n);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let w = 0; w < n; w++) {
      let sum = 0;
      for (let i = w * win; i < (w + 1) * win; i++) sum += d[i] * d[i];
      rms[w] += Math.sqrt(sum / win) / b.numberOfChannels;
    }
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const median = sorted[Math.floor(n / 2)];
  const top = sorted[n - 1] || 1;
  const threshold = Math.max(median * 4, top * 0.3);
  const out: { at: number; power: number }[] = [];
  for (let w = 4; w < n; w++) {
    // A sudden jump well above the bed of rain: a clap starts here.
    const before = Math.max(rms[w - 4], rms[w - 3], rms[w - 2]);
    if (rms[w] < threshold || rms[w] < before * 1.8) continue;
    const at = (w * win) / b.sampleRate;
    if (out.length && at - out[out.length - 1].at < 3) continue;
    out.push({ at, power: Math.min(1, rms[w] / top) });
  }
  return out;
}

interface Track {
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  /** When it started (audio clock) and from where in the recording, to know where it is now. */
  startedAt: number;
  offset: number;
  duration: number;
}

class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private tracks = new Map<Layer, Track>();
  private levels: Record<Layer, number> = { birds: 0, wind: 0, rain: 0, storm: 0 };
  private strikes: { at: number; power: number }[] = [];
  private lastStrike = { i: -1, at: -1e9 };
  private voices: AudioBuffer | null = null;
  private voiceBus: GainNode | null = null;
  /** When each person's current line ends (audio clock), so lines queue rather than overlap. */
  private talkingUntil = new Map<string, number>();

  /** The first touch of the page (or switching sound on): start the audio. */
  wake(): void {
    if (!on) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    // Starts silent and fades in (see apply): no burst of sound on load.
    this.master.gain.value = 0;
    // A gentle limiter: layers adding up (a clap over a downpour) never clip.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -10;
    limit.knee.value = 8;
    limit.ratio.value = 4;
    this.master.connect(limit).connect(ctx.destination);
    for (const layer of Object.keys(VOLUME) as Layer[]) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      const track: Track = { gain, src: null, startedAt: 0, offset: 0, duration: 1 };
      this.tracks.set(layer, track);
      void this.load(url(layer)).then((b) => {
        if (!b) return;
        if (layer === 'storm') this.strikes = findStrikes(b);
        const src = ctx.createBufferSource();
        src.buffer = seamless(ctx, b);
        src.loop = true;
        // Each recording eases in as it arrives, whenever its download finishes.
        const fade = ctx.createGain();
        fade.gain.setValueAtTime(0, ctx.currentTime);
        fade.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
        src.connect(fade).connect(gain);
        // Each visit starts somewhere else in the recording.
        track.offset = Math.random() * src.buffer.duration;
        track.duration = src.buffer.duration;
        track.startedAt = ctx.currentTime;
        src.start(0, track.offset);
        track.src = src;
      });
    }
    this.startMusic(ctx);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = VOICES.volume;
    this.voiceBus.connect(this.master);
    void this.load(url(VOICES.url)).then((b) => (this.voices = b));
    this.apply();
  }

  /**
   * Someone says a line (`chars` long): a murmur of talk at their pitch, made of snippets cut
   * at random from the babble recording. `who` keeps each person's voice their own.
   */
  talk(who: string, chars: number): void {
    const ctx = this.ctx;
    const b = this.voices;
    if (!on || !ctx || !b || !this.voiceBus || ctx.state !== 'running') return;
    let hash = 0;
    for (const ch of who) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    // Each person somewhat lower than the recording, no two alike.
    const pitch = 0.72 + ((hash % 1000) / 1000) * 0.22;
    let t = Math.max(ctx.currentTime + 0.05, this.talkingUntil.get(who) ?? 0);
    const end = t + talkFor(chars);
    while (t < end) {
      const len = 0.14 + Math.random() * 0.38;
      const rate = pitch * (0.95 + Math.random() * 0.1);
      const dur = len / rate;
      const from = Math.random() * (b.duration - len);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      const level = 0.7 + Math.random() * 0.3;
      // Eased in and out: the cuts never click.
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + Math.min(0.03, dur / 4));
      g.gain.setValueAtTime(level, t + dur - Math.min(0.05, dur / 3));
      g.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(g).connect(this.voiceBus);
      src.start(t, from, len);
      src.onended = () => g.disconnect();
      // Mostly running on, now and then a breath between words.
      t += dur - 0.02 + (Math.random() < 0.22 ? 0.08 + Math.random() * 0.22 : 0);
    }
    this.talkingUntil.set(who, end);
  }

  private startMusic(ctx: AudioContext): void {
    const gain = ctx.createGain();
    gain.gain.value = MUSIC.volume;
    gain.connect(this.master!);
    void this.load(url(MUSIC.url)).then((b) => {
      if (!b) return;
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.loopStart = MUSIC.loopStart;
      src.loopEnd = Math.min(MUSIC.loopEnd, b.duration);
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0, ctx.currentTime);
      fade.gain.linearRampToValueAtTime(1, ctx.currentTime + 4);
      src.connect(fade).connect(gain);
      src.start();
    });
  }

  private async load(u: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(u);
      if (!res.ok) return null;
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /**
   * The weather now: `rain` and `storm` 0–1, `day` 0–1 (birds sing by day), `grey` 0–1 (cloud:
   * fewer birds, some wind). Called every frame; only real changes reach the audio.
   */
  update(rain: number, storm: number, day: number, grey: number): void {
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const next: Record<Layer, number> = {
      // About 3 dB down under an overcast sky; quiet as soon as the first drops fall, and from dusk.
      birds: (1 - smooth(0.02, 0.15, rain)) * smooth(0.15, 0.7, day) * (1 - 0.5 * grey),
      // Comes up as it clouds over; the rain (and the storm's own wind) mostly covers it.
      wind: smooth(0.15, 0.55, grey) * (1 - 0.6 * smooth(0.05, 0.5, rain)),
      // The storm recording has rain in it too: the plain rain steps back a little under it.
      rain: (rain < 0.02 ? 0 : 0.25 + 0.75 * rain) * (1 - 0.4 * storm),
      storm: smooth(0.3, 0.9, storm),
    };
    let moved = false;
    for (const k of Object.keys(next) as Layer[]) {
      if (Math.abs(next[k] - this.levels[k]) > 0.004) moved = true;
    }
    if (!moved) return;
    this.levels = next;
    this.apply();
  }

  /** Switched on or off: fade to it. */
  refresh(): void {
    this.apply();
  }

  private apply(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(on ? 1 : 0, t, on ? IN_S : OUT_S);
    for (const [layer, track] of this.tracks) track.gain.gain.setTargetAtTime(VOLUME[layer] * this.levels[layer], t, FADE_S);
  }

  /** The storm recording is playing and audible: the lightning follows it. */
  drivesLightning(): boolean {
    const s = this.tracks.get('storm');
    return !!(on && this.ctx?.state === 'running' && s?.src && this.levels.storm > 0.3 && this.strikes.length);
  }

  /**
   * A thunderclap in the recording within `lead` seconds that hasn't had its flash yet: its
   * power (0 otherwise). The flash goes now, just ahead of the sound.
   */
  strikeDue(lead: number): number {
    const s = this.tracks.get('storm');
    if (!this.ctx || !s?.src || !this.drivesLightning()) return 0;
    const now = this.ctx.currentTime;
    const pos = (now - s.startedAt + s.offset) % s.duration;
    for (let i = 0; i < this.strikes.length; i++) {
      const until = (this.strikes[i].at - pos + s.duration) % s.duration;
      if (until > lead) continue;
      if (i === this.lastStrike.i && now - this.lastStrike.at < s.duration / 2) continue;
      this.lastStrike = { i, at: now };
      return this.strikes[i].power;
    }
    return 0;
  }

  /** Tab hidden: silence it (and save the battery); back: carry on. */
  visible(shown: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const g = this.master.gain;
    if (shown && on) {
      // Back from silence, fading in.
      void ctx.resume().then(() => {
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(0, ctx.currentTime);
        g.setTargetAtTime(1, ctx.currentTime, IN_S);
      });
    } else {
      // A short fade out first, so it doesn't cut off mid-sound.
      g.cancelScheduledValues(ctx.currentTime);
      g.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => {
        if (document.hidden || !on) void ctx.suspend();
      }, 400);
    }
  }
}

export const ambience = new Ambience();

// Browsers only let a page make sound once you've interacted with it.
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => ambience.wake(), { passive: true });
document.addEventListener('visibilitychange', () => ambience.visible(!document.hidden));
