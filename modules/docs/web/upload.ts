// Feltöltés a dokumentumtárba. A jegyzet/felmérés (5.), a chat (7.) és az offline sor (8.) is ezt használja:
// előbb `prepareUpload` (kicsinyítés, hash, kliens oldali azonosító), majd `sendUpload` (újraküldhető, idempotens).
import type { DocsFile } from '../shared.ts';
import { toApiError } from './api.ts';

/** A fotók hosszabb éle legfeljebb ennyi pixel (spec: kliens oldali képtömörítés 2560 px-re). */
export const MAX_EDGE = 2560;
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * A 2560 px-nél nagyobb JPEG/PNG/WebP képet a böngészőben kicsinyíti (az EXIF-tájolás szerint elforgatva; a
 * JPEG/WebP JPEG-ként, 85%-os minőséggel). Kisebb kép, más típus, vagy ha a böngésző nem tudja dekódolni: változatlan.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type) || typeof createImageBitmap === 'undefined') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  if (width === bitmap.width && height === bitmap.height) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) return file;
  const name = type === 'image/jpeg' ? file.name.replace(/\.(jpe?g|webp)$/i, '') + '.jpg' : file.name;
  return new File([blob], name, { type, lastModified: file.lastModified });
}

/** sha256 hexben; nem biztonságos (http) címen nincs `crypto.subtle`, akkor `undefined` (a szerver maga számolja). */
export async function sha256Hex(blob: Blob): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (!subtle) return undefined;
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Kliens oldali UUID (v4); a `crypto.randomUUID` csak biztonságos címen van. */
export function newId(): string {
  const randomUUID = globalThis.crypto?.randomUUID as (() => string) | undefined;
  if (randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface UploadOptions {
  folderId?: string | null;
  /** Szülő-esemény (pl. a felmérésé), hogy az idővonalon egy csoportban legyenek. */
  parentEventId?: string | null;
}

/** Feltöltésre kész elem: IndexedDB-be is tehető (a `Blob` tárolható), és újraküldve sem duplikál. */
export interface PreparedUpload extends UploadOptions {
  id: string;
  projectId: string;
  name: string;
  type: string;
  sha256?: string;
  blob: Blob;
}

export async function prepareUpload(projectId: string, file: File, opts: UploadOptions = {}): Promise<PreparedUpload> {
  const prepared = await prepareImage(file);
  return {
    id: newId(),
    projectId,
    name: prepared.name,
    type: prepared.type,
    sha256: await sha256Hex(prepared),
    blob: prepared,
    folderId: opts.folderId ?? null,
    parentEventId: opts.parentEventId ?? null,
  };
}

export function uploadUrl(u: Omit<PreparedUpload, 'blob'>): string {
  const q = new URLSearchParams({ name: u.name });
  if (u.type) q.set('type', u.type);
  if (u.sha256) q.set('sha256', u.sha256);
  if (u.folderId) q.set('folderId', u.folderId);
  if (u.parentEventId) q.set('parentEventId', u.parentEventId);
  return `/api/docs/projects/${u.projectId}/files/${u.id}?${q}`;
}

/** `PUT` a kliens oldali azonosítóval: új fájlnál 201, már feltöltöttnél 200 ugyanazzal a fájllal. */
export async function sendUpload(u: PreparedUpload): Promise<DocsFile> {
  const res = await fetch(uploadUrl(u), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: u.blob,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as DocsFile;
}

export async function uploadFile(projectId: string, file: File, opts: UploadOptions = {}): Promise<DocsFile> {
  return sendUpload(await prepareUpload(projectId, file, opts));
}
