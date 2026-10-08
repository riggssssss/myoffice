/**
 * How you've set up the office on screen (layout, finishes, styles, theme) is kept by the local
 * server as well as in this browser, so it's all there tomorrow: in another browser, a private
 * window, or after clearing the site's data. Each copy carries when it was saved and the newer
 * one wins; a browser's copy from before this sync (no date) is the real work, so it's kept.
 */
const KEYS = {
  layout: 'oficina-3d:layout',
  theme: 'oficina-3d:theme-choice',
} as const;

export type PrefName = keyof typeof KEYS;

let token = '';
/** The session token (once restorePrefs has run), for other calls to the local server. */
export const apiToken = () => token;
const timers = new Map<PrefName, number>();

const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* full or blocked: the server's copy still has it */
    }
  },
};

const atKey = (name: PrefName) => `${KEYS[name]}:at`;

async function put(name: PrefName, value: string, at: number): Promise<void> {
  if (!token) return;
  try {
    await fetch(`/api/prefs/${name}`, {
      method: 'PUT',
      headers: { 'x-oficina-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ value, at }),
    });
  } catch {
    /* the server is down: this browser keeps it and hands it over next time */
  }
}

/** Before the office is drawn: bring the saved setup into this browser. */
export async function restorePrefs(): Promise<void> {
  try {
    const s = await fetch('/api/session', { credentials: 'same-origin' });
    if (!s.ok) return;
    token = ((await s.json()) as { token: string }).token;
    const res = await fetch('/api/prefs', { headers: { 'x-oficina-token': token } });
    if (!res.ok) return;
    const saved = (await res.json()) as Partial<Record<PrefName, { value: string; at: number } | null>>;
    for (const name of Object.keys(KEYS) as PrefName[]) {
      const theirs = saved[name];
      const mine = local.get(KEYS[name]);
      const mineAt = Number(local.get(atKey(name))) || null;
      if (mine && (!theirs || mineAt === null || mineAt > theirs.at)) {
        // This browser has the newer (or the only, or the pre-sync) copy: the server gets it.
        const at = mineAt ?? Date.now();
        local.set(atKey(name), String(at));
        void put(name, mine, at);
      } else if (theirs) {
        local.set(KEYS[name], theirs.value);
        local.set(atKey(name), String(theirs.at));
      }
    }
  } catch {
    /* no server yet: this browser's copy is used */
  }
}

export function readPref(name: PrefName): string | null {
  return local.get(KEYS[name]);
}

/** Saved here at once and on the server a moment later (dragging furniture saves often). */
export function savePref(name: PrefName, value: string): void {
  const at = Date.now();
  local.set(KEYS[name], value);
  local.set(atKey(name), String(at));
  clearTimeout(timers.get(name));
  timers.set(
    name,
    window.setTimeout(() => void put(name, value, at), 400),
  );
}

// Closing the tab right after a change: send what's pending.
addEventListener('pagehide', () => {
  for (const [name, t] of timers) {
    clearTimeout(t);
    const value = local.get(KEYS[name]);
    if (value && token) {
      void fetch(`/api/prefs/${name}`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'x-oficina-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ value, at: Number(local.get(atKey(name))) || Date.now() }),
      });
    }
  }
  timers.clear();
});
