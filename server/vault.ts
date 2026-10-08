/**
 * The vault: API keys and tokens, encrypted at rest (AES-256-GCM). The key lives in the
 * operating system's keychain, so a copied vault file is useless on another account or
 * machine. Where there is no keychain, a passphrase (OFICINA_PASSPHRASE) derives it instead.
 *
 * Values never leave the server: callers outside get names and the last 4 characters only.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Entry } from '@napi-rs/keyring';
import { dataPath } from './paths';

const FILE = 'vault.enc';
const KEYCHAIN_SERVICE = 'oficina-3d';
const KEYCHAIN_ACCOUNT = 'vault-key';
/** Secret names double as `${secret:name}` references in config files. */
export const SECRET_NAME = /^[a-z0-9_]{1,64}$/;

interface VaultFile {
  v: 1;
  /** 'keychain', or 'passphrase' with the scrypt salt. */
  kdf: 'keychain' | 'passphrase';
  salt?: string;
  iv: string;
  tag: string;
  data: string;
}

let key: Buffer | null = null;
let kdf: VaultFile['kdf'] = 'keychain';
let salt: Buffer | undefined;
let secrets = new Map<string, string>();

function keychainKey(): Buffer {
  const entry = new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  let stored: string | null = null;
  try {
    stored = entry.getPassword() ?? null;
  } catch {
    stored = null;
  }
  if (stored) return Buffer.from(stored, 'base64');
  const fresh = randomBytes(32);
  entry.setPassword(fresh.toString('base64'));
  return fresh;
}

function passphraseKey(s: Buffer): Buffer {
  const pass = process.env.OFICINA_PASSPHRASE;
  if (!pass) {
    throw new Error(
      'No hay llavero del sistema disponible. Arranca con OFICINA_PASSPHRASE=<frase> para cifrar la bóveda con una frase de paso.',
    );
  }
  return scryptSync(pass, s, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Opens (or creates) the vault. Throws if it exists but can't be decrypted. */
export function openVault(): void {
  const path = dataPath(FILE);
  const existing = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as VaultFile) : null;

  kdf = existing?.kdf ?? (process.env.OFICINA_PASSPHRASE ? 'passphrase' : 'keychain');
  if (kdf === 'keychain') {
    try {
      key = keychainKey();
    } catch (e) {
      if (existing) throw new Error(`No se puede leer la clave de la bóveda del llavero del sistema: ${(e as Error).message}`);
      kdf = 'passphrase';
    }
  }
  if (kdf === 'passphrase') {
    salt = existing?.salt ? Buffer.from(existing.salt, 'base64') : randomBytes(16);
    key = passphraseKey(salt);
  }

  if (!existing) {
    secrets = new Map();
    persist();
    return;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key!, Buffer.from(existing.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(existing.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(existing.data, 'base64')), decipher.final()]);
    secrets = new Map(Object.entries(JSON.parse(plain.toString('utf8')) as Record<string, string>));
  } catch {
    throw new Error('La bóveda no se puede descifrar con esta clave (¿otro usuario, otra máquina o frase de paso distinta?).');
  }
}

function persist(): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key!, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(secrets)), 'utf8'), cipher.final()]);
  const file: VaultFile = {
    v: 1,
    kdf,
    ...(kdf === 'passphrase' ? { salt: salt!.toString('base64') } : {}),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  // Write-then-rename: a crash mid-write never leaves a half vault.
  const path = dataPath(FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(file), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

/** For the UI: which secrets exist, never their values. */
export function listSecrets(): { name: string; last4: string }[] {
  return [...secrets].map(([name, v]) => ({ name, last4: v.length > 8 ? v.slice(-4) : '' })).sort((a, b) => a.name.localeCompare(b.name));
}

export function setSecret(name: string, value: string): void {
  if (!SECRET_NAME.test(name)) throw new Error('Nombre de secreto no válido');
  secrets.set(name, value);
  persist();
}

export function deleteSecret(name: string): void {
  if (secrets.delete(name)) persist();
}

/** Server-internal: only for handing a key to the service or MCP process that needs it. */
export function getSecret(name: string): string | undefined {
  return secrets.get(name);
}

/** Masks every stored value in a text before it reaches a log, a transcript or the browser. */
export function redact(text: string): string {
  let out = text;
  for (const v of secrets.values()) if (v.length >= 6) out = out.split(v).join('•••');
  return out;
}
