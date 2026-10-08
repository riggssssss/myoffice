/**
 * Where this machine's office lives: the user's data directory, never the project folder,
 * so sharing the code (or a build) can't carry anyone's keys, memories or minutes along.
 */
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const APP = 'Oficina3D';

function base(): string {
  // Tests and second installs can point elsewhere.
  if (process.env.OFICINA_DATA_DIR) return process.env.OFICINA_DATA_DIR;
  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', APP);
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP);
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), APP);
  }
}

export const DATA_DIR = base();

/** Creates the data directory, readable by this user only. */
export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (platform() !== 'win32') chmodSync(DATA_DIR, 0o700);
}

export const dataPath = (name: string) => join(DATA_DIR, name);
