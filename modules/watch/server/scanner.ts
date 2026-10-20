import path from 'node:path';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ModuleContext } from '@derp/server/module-api';
import { WATCH_EVENTS, type ScanResult, type WatchFileEventData } from '../shared.ts';
import { hashFile, mapLimit, resolveInside, walk, WatchFsError, type FsEntry } from './fs.ts';
import { watchFiles, watchMappings } from './schema.ts';

type FileRow = typeof watchFiles.$inferSelect;
type Tx = Parameters<Parameters<ModuleContext['db']['transaction']>[0]>[0];

const HASH_PARALLEL = 8;
const INSERT_CHUNK = 1000;

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export const emptyResult = (error: string | null = null): ScanResult => ({ added: 0, modified: 0, deleted: 0, renamed: 0, files: 0, error });

/** Az idővonal-esemény adatai egy fájlsorból. */
const eventData = (row: Pick<FileRow, 'id' | 'path' | 'size' | 'mtime'>, oldPath?: string): WatchFileEventData => ({
  fileId: row.id,
  path: row.path,
  name: baseName(row.path),
  size: row.size,
  mtime: row.mtime.toISOString(),
  ...(oldPath ? { oldPath } : {}),
});

/**
 * A bejárás egyszerre egy példányban fut (az ütemezett és a kézi „Most ellenőrizd” is ide áll sorba), így ugyanazt a
 * mappát két bejárás nem dolgozza fel egyszerre.
 */
export class Scanner {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly ctx: ModuleContext;
  readonly root: string;

  constructor(ctx: ModuleContext, root: string) {
    this.ctx = ctx;
    this.root = root;
  }

  /** A `fn` a korábban sorba állítottak után fut; a hibája csak a hívóhoz jut el. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Egy projekt hozzárendelt almappájának bejárása (sorba állítva). */
  scan(projectId: string, opts: { baseline?: boolean } = {}): Promise<ScanResult> {
    return this.exclusive(() => scanProject(this.ctx, this.root, projectId, opts));
  }

  /** Minden élő projekt hozzárendelt almappájának bejárása (az ütemező hívja). */
  async scanAll(): Promise<Map<string, ScanResult>> {
    const { rows } = await this.ctx.pool.query<{ project_id: string }>(
      `SELECT m.project_id FROM watch_mappings m JOIN projects p ON p.id = m.project_id WHERE p.deleted_at IS NULL ORDER BY m.path`,
    );
    const out = new Map<string, ScanResult>();
    for (const r of rows) out.set(r.project_id, await this.scan(r.project_id));
    return out;
  }
}

/**
 * Az esemény időpontja új és módosult fájlnál: a fájl módosítási ideje, ha az előző bejárás és most közé esik; ha nem
 * (pl. a másolás megőrizte a régi dátumot, vagy eltér a szerver órája), az észlelés ideje, hogy az esemény ne kerüljön
 * az idővonal régi részébe.
 */
export function eventTime(mtime: Date, previousScan: Date | null, now: Date): Date {
  return previousScan && mtime > previousScan && mtime <= now ? mtime : now;
}

/**
 * Egy projekt almappájának bejárása és összevetése a tárolt állapottal: új, módosult (méret vagy módosítási idő eltér,
 * és a hash is), törölt és átnevezett (egy eltűnt és egy új fájl hash-e egyezik) fájlok. A változások egy
 * tranzakcióban kerülnek a `watch_files` táblába és eseményként az idővonalra. `baseline` esetén (az almappa
 * hozzárendelésekor) a meglévő fájlok esemény nélkül kerülnek be.
 *
 * Ha a gyökér vagy az almappa nem érhető el, vagy egy könyvtára nem olvasható, nem változik semmi (a fájlok nem
 * látszanak töröltnek), csak a hiba kerül a hozzárendelésre.
 */
export async function scanProject(
  ctx: ModuleContext,
  root: string,
  projectId: string,
  { baseline = false }: { baseline?: boolean } = {},
): Promise<ScanResult> {
  const [mapping] = await ctx.db.select().from(watchMappings).where(eq(watchMappings.projectId, projectId));
  if (!mapping) return emptyResult('Ehhez a projekthez nincs hozzárendelt mappa');

  let dir: string;
  let found: Map<string, FsEntry>;
  try {
    dir = await resolveInside(root, mapping.path);
    found = await walk(dir);
  } catch (err) {
    if (!(err instanceof WatchFsError)) throw err;
    await ctx.db.update(watchMappings).set({ lastError: err.message }).where(eq(watchMappings.projectId, projectId));
    return emptyResult(err.message);
  }

  const rows = await ctx.db
    .select()
    .from(watchFiles)
    .where(and(eq(watchFiles.projectId, projectId), isNull(watchFiles.deletedAt)));
  const known = new Map(rows.map((r) => [r.path, r]));

  const newEntries: FsEntry[] = [];
  const changed: Array<{ row: FileRow; entry: FsEntry }> = [];
  for (const entry of found.values()) {
    const row = known.get(entry.path);
    if (!row) newEntries.push(entry);
    else if (row.size !== entry.size || row.mtime.getTime() !== entry.mtimeMs) changed.push({ row, entry });
  }
  const gone = rows.filter((r) => !found.has(r.path));

  // Hash csak az új és a megváltozott fájloké; ami közben eltűnt, azt a következő bejárás kezeli.
  const abs = (rel: string) => path.join(dir, ...rel.split('/'));
  const hashes = new Map<string, string | null>();
  await mapLimit([...newEntries, ...changed.map((c) => c.entry)], HASH_PARALLEL, async (e) => {
    hashes.set(e.path, await hashFile(abs(e.path)));
  });

  // Átnevezés: egy eltűnt fájl hash-e egyezik egy új fájléval (azonos név előnyben, pl. áthelyezésnél).
  const goneByHash = new Map<string, FileRow[]>();
  for (const r of gone) if (r.sha256) goneByHash.set(r.sha256, [...(goneByHash.get(r.sha256) ?? []), r]);
  const renamed: Array<{ row: FileRow; entry: FsEntry; sha256: string }> = [];
  const added: Array<{ entry: FsEntry; sha256: string }> = [];
  for (const entry of newEntries.sort((a, b) => a.path.localeCompare(b.path))) {
    const sha256 = hashes.get(entry.path);
    if (!sha256) continue;
    const candidates = goneByHash.get(sha256);
    if (candidates?.length) {
      const i = Math.max(0, candidates.findIndex((r) => baseName(r.path) === baseName(entry.path)));
      renamed.push({ row: candidates.splice(i, 1)[0]!, entry, sha256 });
    } else {
      added.push({ entry, sha256 });
    }
  }
  const renamedIds = new Set(renamed.map((r) => r.row.id));
  const deleted = gone.filter((r) => !renamedIds.has(r.id)).sort((a, b) => a.path.localeCompare(b.path));
  const modified: Array<{ row: FileRow; entry: FsEntry; sha256: string }> = [];
  const touched: Array<{ row: FileRow; entry: FsEntry }> = [];
  for (const c of changed) {
    const sha256 = hashes.get(c.entry.path);
    if (!sha256) continue;
    if (sha256 === c.row.sha256) touched.push(c);
    else modified.push({ ...c, sha256 });
  }

  const now = new Date();
  const when = (mtimeMs: number) => eventTime(new Date(mtimeMs), mapping.lastScanAt, now);
  const event = (tx: Tx, type: string, title: string, data: WatchFileEventData, occurredAt: Date) =>
    ctx.appendEvent({ projectId, type, source: 'filesystem', title, data: { ...data }, occurredAt }, tx);

  await ctx.db.transaction(async (tx) => {
    for (const { row, entry, sha256 } of renamed) {
      const [next] = await tx
        .update(watchFiles)
        .set({ path: entry.path, size: entry.size, mtime: new Date(entry.mtimeMs), sha256, updatedAt: now })
        .where(eq(watchFiles.id, row.id))
        .returning();
      const sameName = baseName(row.path) === baseName(entry.path);
      const title = `Fájl átnevezve a szerveren: ${sameName ? row.path : baseName(row.path)} → ${sameName ? entry.path : baseName(entry.path)}`;
      if (!baseline) await event(tx, WATCH_EVENTS.fileRenamed, title, eventData(next!, row.path), now);
    }

    const inserted = added.map(({ entry, sha256 }) => ({
      id: crypto.randomUUID(),
      projectId,
      path: entry.path,
      size: entry.size,
      mtime: new Date(entry.mtimeMs),
      sha256,
      firstSeenAt: now,
      updatedAt: now,
    }));
    for (let i = 0; i < inserted.length; i += INSERT_CHUNK) await tx.insert(watchFiles).values(inserted.slice(i, i + INSERT_CHUNK));
    if (!baseline) {
      for (const row of inserted) {
        await event(tx, WATCH_EVENTS.fileAdded, `Új fájl a szerveren: ${baseName(row.path)}`, eventData(row), when(row.mtime.getTime()));
      }
    }

    for (const { row, entry, sha256 } of modified) {
      const [next] = await tx
        .update(watchFiles)
        .set({ size: entry.size, mtime: new Date(entry.mtimeMs), sha256, updatedAt: now })
        .where(eq(watchFiles.id, row.id))
        .returning();
      if (!baseline) await event(tx, WATCH_EVENTS.fileModified, `Fájl módosult a szerveren: ${baseName(row.path)}`, eventData(next!), when(entry.mtimeMs));
    }
    // Csak a módosítási idő változott, a tartalom nem: esemény nélkül.
    for (const { row, entry } of touched) {
      await tx.update(watchFiles).set({ size: entry.size, mtime: new Date(entry.mtimeMs), updatedAt: now }).where(eq(watchFiles.id, row.id));
    }

    if (deleted.length) {
      await tx.update(watchFiles).set({ deletedAt: now }).where(inArray(watchFiles.id, deleted.map((r) => r.id)));
      if (!baseline) {
        for (const row of deleted) await event(tx, WATCH_EVENTS.fileDeleted, `Fájl törölve a szerverről: ${baseName(row.path)}`, eventData(row), now);
      }
    }

    await tx.update(watchMappings).set({ lastScanAt: now, lastError: null }).where(eq(watchMappings.projectId, projectId));
  });

  return {
    added: added.length,
    modified: modified.length,
    deleted: deleted.length,
    renamed: renamed.length,
    files: rows.length - deleted.length + added.length,
    error: null,
  };
}

/** A projekt minden élő fájlsorát töröltnek jelöli, esemény nélkül (a hozzárendelés megszüntetésekor vagy cseréjekor). */
export async function forgetFiles(tx: Tx, projectId: string, now = new Date()): Promise<void> {
  await tx
    .update(watchFiles)
    .set({ deletedAt: now })
    .where(and(eq(watchFiles.projectId, projectId), isNull(watchFiles.deletedAt)));
}

/** A hozzárendelésekhez tartozó élő fájlok száma projektenként. */
export async function fileCounts(ctx: ModuleContext, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ projectId: watchFiles.projectId, n: sql<number>`count(*)::int` })
    .from(watchFiles)
    .where(and(inArray(watchFiles.projectId, projectIds), isNull(watchFiles.deletedAt)))
    .groupBy(watchFiles.projectId);
  return new Map(rows.map((r) => [r.projectId, r.n]));
}
