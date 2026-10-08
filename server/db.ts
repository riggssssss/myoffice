/** The office's database: one SQLite file in the user's data directory. */
import { chmodSync, existsSync } from 'node:fs';
import { platform } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { dataPath } from './paths';

let db: DatabaseSync;

export function openDb(): void {
  const path = dataPath('oficina.db');
  const fresh = !existsSync(path);
  db = new DatabaseSync(path);
  if (fresh && platform() !== 'win32') chmodSync(path, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function getJson<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setJson(key: string, value: unknown): void {
  db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

export function closeDb(): void {
  db?.close();
}
