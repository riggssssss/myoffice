/**
 * Files in the chats: the ones you send and the ones the agents make for you. They live in the
 * office's data folder (never the project, so sharing the app shares none of them), are served
 * only to this app's own pages with its session token, and are never run: pictures and PDFs show,
 * everything else downloads. What's inside is checked against what it claims to be.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { ChatFile } from '../src/sim/types';
import { getJson, setJson } from './db';
import { dataPath } from './paths';

export const MAX_FILE = 20 * 1024 * 1024;
const KEEP = 300;
const ID = /^f[0-9a-f]{24}$/;

/** What can come in, by type: pictures show, the rest is read by the agents and downloads. */
const TYPES: Record<string, { ext: string[]; kind: ChatFile['kind'] }> = {
  'image/png': { ext: ['png'], kind: 'image' },
  'image/jpeg': { ext: ['jpg', 'jpeg'], kind: 'image' },
  'image/webp': { ext: ['webp'], kind: 'image' },
  'image/gif': { ext: ['gif'], kind: 'image' },
  'application/pdf': { ext: ['pdf'], kind: 'doc' },
  'text/plain': { ext: ['txt', 'log'], kind: 'doc' },
  'text/markdown': { ext: ['md', 'markdown'], kind: 'doc' },
  'text/csv': { ext: ['csv'], kind: 'doc' },
  'application/json': { ext: ['json'], kind: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], kind: 'doc' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], kind: 'doc' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: ['pptx'], kind: 'doc' },
};

const dir = () => {
  const d = dataPath('files');
  if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};
const index = () => getJson<ChatFile[]>('files:index') ?? [];

/** The type from the bytes themselves, for what has a signature; the name's ending for text. */
function sniff(bytes: Buffer, name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const head = bytes.subarray(0, 12);
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // A zip: only Office documents, by their ending.
    return Object.entries(TYPES).find(([t, v]) => t.includes('officedocument') && v.ext.includes(ext))?.[0] ?? null;
  }
  // Text: valid UTF-8 without NULs, named as one of ours.
  const text = Object.entries(TYPES).find(([t, v]) => (t.startsWith('text/') || t === 'application/json') && v.ext.includes(ext))?.[0];
  if (!text || bytes.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text;
  } catch {
    return null;
  }
}

/** A name that's safe to show and to download as: no paths, no control characters. */
function cleanName(name: string, type: string): string {
  const base = name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 120) || 'archivo';
  const ext = TYPES[type].ext;
  return ext.includes(base.toLowerCase().split('.').pop() ?? '') ? base : `${base}.${ext[0]}`;
}

/** Keep a file. Fails with a reason you can read if it isn't one we take. */
export function saveFile(name: string, bytes: Buffer): ChatFile {
  if (!bytes.length) throw new Error('El archivo está vacío');
  if (bytes.length > MAX_FILE) throw new Error('Pesa demasiado: el máximo son 20 MB');
  const type = sniff(bytes, name);
  if (!type) throw new Error('Ese tipo de archivo no se admite: imágenes (PNG, JPG, WebP, GIF), PDF, texto, Markdown, CSV, JSON y Word, Excel o PowerPoint');
  const file: ChatFile = { id: `f${randomBytes(12).toString('hex')}`, name: cleanName(name, type), type, size: bytes.length, kind: TYPES[type].kind };
  writeFileSync(join(dir(), file.id), bytes, { mode: 0o600 });
  const all = [file, ...index()];
  // The oldest go once there are too many.
  for (const old of all.slice(KEEP)) rmSync(join(dir(), old.id), { force: true });
  setJson('files:index', all.slice(0, KEEP));
  return file;
}

/** A document an agent writes for you (text: Markdown, CSV, plain text or JSON). */
export function makeFile(name: string, text: string): ChatFile {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const named = ['md', 'txt', 'csv', 'json'].includes(ext) ? name : `${name || 'documento'}.md`;
  return saveFile(named, Buffer.from(text, 'utf8'));
}

export const fileInfo = (id: string): ChatFile | null => (ID.test(id) ? (index().find((f) => f.id === id) ?? null) : null);

export function fileBytes(id: string): Buffer | null {
  const f = fileInfo(id);
  if (!f) return null;
  try {
    return readFileSync(join(dir(), f.id));
  } catch {
    return null;
  }
}

/** How the browser gets it: shown if it's a picture or a PDF, downloaded otherwise; never run. */
export function fileHeaders(f: ChatFile): Record<string, string> {
  const inline = f.kind === 'image' || f.type === 'application/pdf';
  return {
    'content-type': f.type,
    'content-length': String(f.size),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'cache-control': 'private, max-age=86400',
  };
}

const CACHE = new Map<string, string>();

/** What a document says, as plain text for the agents (cut to `max` characters). */
export async function fileText(id: string, max = 20_000): Promise<string | null> {
  const f = fileInfo(id);
  if (!f || f.kind !== 'doc') return null;
  if (!CACHE.has(id)) {
    const bytes = fileBytes(id);
    if (!bytes) return null;
    CACHE.set(id, await extract(f, bytes).catch(() => ''));
    if (CACHE.size > 40) CACHE.delete(CACHE.keys().next().value!);
  }
  const text = CACHE.get(id)!;
  return text.length > max ? `${text.slice(0, max)}\n… (cortado: el documento sigue)` : text;
}

async function extract(f: ChatFile, bytes: Buffer): Promise<string> {
  if (f.type.startsWith('text/') || f.type === 'application/json') return bytes.toString('utf8');
  if (f.type === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text).replace(/[ \t]+\n/g, '\n').trim();
  }
  // Word, Excel, PowerPoint: the text inside their XML.
  const zip = unzipSync(new Uint8Array(bytes), {
    filter: (e) => /^(word\/document|word\/footnotes|xl\/sharedStrings|xl\/worksheets\/sheet\d+|ppt\/slides\/slide\d+)\.xml$/.test(e.name) && e.originalSize < 30 * 1024 * 1024,
  });
  const parts = Object.keys(zip)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) =>
      strFromU8(zip[name])
        .replace(/<\/(w:p|a:p|row)>/g, '\n')
        .replace(/<(w:tab|c)\b[^>]*\/?>/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'),
    );
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A picture, ready for an AI that sees (base64), if it's small enough for them. */
export function imageData(id: string): { type: string; data: string } | null {
  const f = fileInfo(id);
  if (!f || f.kind !== 'image' || f.size > 3.5 * 1024 * 1024) return null;
  const bytes = fileBytes(id);
  return bytes ? { type: f.type, data: bytes.toString('base64') } : null;
}
