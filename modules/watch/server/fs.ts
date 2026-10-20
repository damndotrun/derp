import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * A figyelt gyökér: `WATCH_ROOT` (alapérték `/watch`, a spec konfigurációs táblája szerint). Teszt módban, ha nincs
 * megadva, egy írható ideiglenes könyvtár, hogy a `POST /api/test/watch-file` külön beállítás nélkül is működjön.
 */
export function watchRoot(env: NodeJS.ProcessEnv = process.env, nodeEnv?: string): string {
  if (env.WATCH_ROOT) return env.WATCH_ROOT;
  return nodeEnv === 'test' ? path.join(tmpdir(), 'derp-watch-test') : '/watch';
}

/** `WATCH_INTERVAL_SEC` másodpercben (alapérték 300); `0` = nincs ütemezett bejárás, csak a kézi „Most ellenőrizd”. */
export function watchIntervalSec(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WATCH_INTERVAL_SEC;
  if (raw === undefined || raw.trim() === '') return 300;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`WATCH_INTERVAL_SEC: nem negatív egész szám kell, ez nem az: „${raw}”`);
  return n;
}

export class WatchFsError extends Error {}

/**
 * A szerver-mappák szokásos rendszer- és ideiglenes fájljai, amelyek nem kerülnek az idővonalra: rejtett fájlok és
 * mappák (`.DS_Store`, `.zfs`), Office-zárolófájlok (`~$…`, `~….tmp`), Windows (`Thumbs.db`, `desktop.ini`) és Synology
 * (`@eaDir`, `#recycle`, `#snapshot`) segédfájlok.
 */
export function isIgnored(name: string): boolean {
  return (
    name.startsWith('.') ||
    name.startsWith('~$') ||
    /^~.*\.tmp$/i.test(name) ||
    /^(thumbs\.db|desktop\.ini|@eadir|#recycle|#snapshot)$/i.test(name)
  );
}

const isInside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/** A gyökér valódi útvonala; ha nem érhető el, `WatchFsError`. */
export async function realRoot(root: string): Promise<string> {
  try {
    const real = await realpath(root);
    if (!(await stat(real)).isDirectory()) throw new Error('nem könyvtár');
    return real;
  } catch {
    throw new WatchFsError('A figyelt szerver-mappa nem érhető el');
  }
}

/**
 * Egy relatív útvonal (`a/b`) valódi helye a gyökér alatt. Szimbolikus linkkel sem mutathat a gyökéren kívülre; ha nem
 * létezik vagy kívül esik, `WatchFsError`.
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const base = await realRoot(root);
  let real: string;
  try {
    real = await realpath(path.join(base, ...rel.split('/')));
  } catch {
    throw new WatchFsError(`A mappa nem található: ${rel}`);
  }
  if (!isInside(base, real)) throw new WatchFsError(`A mappa nem található: ${rel}`);
  return real;
}

/** A gyökérhez képest relatív, `/`-rel elválasztott útvonal. */
export const toRel = (base: string, abs: string) => path.relative(base, abs).split(path.sep).join('/');

/** Egy könyvtár közvetlen almappái (rejtett és rendszermappák, szimbolikus linkek nélkül), név szerint. */
export async function listFolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !isIgnored(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'hu'));
}

export interface FsEntry {
  /** A bejárt könyvtárhoz képest, `/`-rel. */
  path: string;
  size: number;
  /** Ezredmásodpercre kerekítve (az adatbázis is így tárolja). */
  mtimeMs: number;
}

/** Legfeljebb `limit` párhuzamos művelet. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const PARALLEL = 32;

/**
 * Egy könyvtár teljes bejárása: minden fájl útvonala, mérete és módosítási ideje (hash nélkül). A szimbolikus
 * linkeket és a rendszerfájlokat kihagyja. Ha egy könyvtár nem olvasható, az egész bejárás hibát dob, hogy egy
 * olvashatatlan almappa fájljai ne látsszanak töröltnek.
 */
export async function walk(dir: string): Promise<Map<string, FsEntry>> {
  const files = new Map<string, FsEntry>();
  let dirs = [''];
  while (dirs.length) {
    const nextDirs: string[] = [];
    await mapLimit(dirs, PARALLEL, async (rel) => {
      const abs = rel ? path.join(dir, ...rel.split('/')) : dir;
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch (err) {
        throw new WatchFsError(`A mappa nem olvasható: ${rel || '.'} (${(err as NodeJS.ErrnoException).code ?? 'hiba'})`);
      }
      const fileNames: string[] = [];
      for (const e of entries) {
        if (isIgnored(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) nextDirs.push(childRel);
        else if (e.isFile()) fileNames.push(childRel);
      }
      await mapLimit(fileNames, PARALLEL, async (fileRel) => {
        try {
          const s = await lstat(path.join(dir, ...fileRel.split('/')));
          if (s.isFile()) files.set(fileRel, { path: fileRel, size: s.size, mtimeMs: Math.floor(s.mtimeMs) });
        } catch (err) {
          // A listázás és a stat között eltűnt fájl: a következő bejárás már nem látja.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      });
    });
    dirs = nextDirs;
  }
  return files;
}

/** A fájl sha256-ja; ha közben eltűnt, `null`. */
export async function hashFile(abs: string): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    await pipeline(createReadStream(abs), hash);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return hash.digest('hex');
}
