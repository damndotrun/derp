import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db, ModuleContext } from '@derp/server/module-api';
import { DOCS_EVENTS, type DocsFile, type DocsFileEventData, type DocsFolder } from '../shared.ts';
import type { BlobStore, TempBlob } from './blob-store.ts';
import { canThumb } from './mime.ts';
import { docsBlobs, docsFiles, docsFolders } from './schema.ts';
import { makeThumb } from './thumbs.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type FileRow = typeof docsFiles.$inferSelect;
type FolderRow = typeof docsFolders.$inferSelect;

/** A dokumentumtár szolgáltatásai; az útvonalak és a tesztek ezen át érik el az adatbázist és a fájltárat. */
export interface Docs {
  ctx: ModuleContext;
  store: BlobStore;
}

const fileColumns = {
  file: docsFiles,
  hasThumb: docsBlobs.hasThumb,
  uploaderName: sql<string | null>`(SELECT name FROM users WHERE users.id = ${docsFiles.uploadedBy})`,
};

type FileWithMeta = { file: FileRow; hasThumb: boolean; uploaderName: string | null };

const toFileDto = ({ file, hasThumb, uploaderName }: FileWithMeta): DocsFile => ({
  id: file.id,
  projectId: file.projectId,
  folderId: file.folderId,
  name: file.name,
  mime: file.mime,
  size: file.size,
  sha256: file.sha256,
  hasThumb,
  uploadedBy: file.uploadedBy ? { id: file.uploadedBy, name: uploaderName ?? '' } : null,
  eventId: file.eventId,
  version: file.version,
  createdAt: file.createdAt.toISOString(),
});

const toFolderDto = (f: FolderRow): DocsFolder => ({
  id: f.id,
  projectId: f.projectId,
  parentId: f.parentId,
  name: f.name,
  version: f.version,
  createdAt: f.createdAt.toISOString(),
});

const eventData = (f: FileRow, thumb: boolean): DocsFileEventData => ({
  fileId: f.id,
  name: f.name,
  mime: f.mime,
  size: f.size,
  folderId: f.folderId,
  thumb,
});

const isImage = (mime: string) => mime.startsWith('image/');

export async function listProjectDocs(db: Db, projectId: string): Promise<{ folders: DocsFolder[]; files: DocsFile[] }> {
  const folders = await db.select().from(docsFolders).where(eq(docsFolders.projectId, projectId)).orderBy(asc(docsFolders.name));
  const files = await db
    .select(fileColumns)
    .from(docsFiles)
    .innerJoin(docsBlobs, eq(docsBlobs.sha256, docsFiles.sha256))
    .where(eq(docsFiles.projectId, projectId))
    .orderBy(sql`${docsFiles.createdAt} DESC`, asc(docsFiles.name));
  return { folders: folders.map(toFolderDto), files: files.map(toFileDto) };
}

export async function getFile(db: Db, id: string): Promise<DocsFile | null> {
  const [row] = await db
    .select(fileColumns)
    .from(docsFiles)
    .innerJoin(docsBlobs, eq(docsBlobs.sha256, docsFiles.sha256))
    .where(eq(docsFiles.id, id))
    .limit(1);
  return row ? toFileDto(row) : null;
}

export async function getFolder(db: Db, id: string): Promise<DocsFolder | null> {
  const [row] = await db.select().from(docsFolders).where(eq(docsFolders.id, id)).limit(1);
  return row ? toFolderDto(row) : null;
}

/** A mappa a projekthez tartozik-e (különben 400). */
export async function requireFolderIn(docs: Docs, projectId: string, folderId: string | null | undefined): Promise<void> {
  if (!folderId) return;
  const folder = await getFolder(docs.ctx.db, folderId);
  if (!folder || folder.projectId !== projectId) throw docs.ctx.errors.badRequest('A mappa nem ehhez a projekthez tartozik');
}

export interface UploadInput {
  id: string;
  projectId: string;
  folderId: string | null;
  name: string;
  mime: string;
  temp: TempBlob;
  parentEventId: string | null;
}

/**
 * Egy feltöltött fájl rögzítése. Ugyanazzal az azonosítóval újra küldve nem jön létre új sor (`created: false`);
 * ha az azonosító már más tartalomhoz vagy projekthez tartozik, 409. Azonos tartalom (sha256) esetén a blob
 * egyszer van a lemezen, a fájl-sorok rá hivatkoznak. A blob sorát a tranzakció zárolja, így egy párhuzamos
 * törlés nem veheti ki alóla a lemezen lévő fájlt.
 */
export async function storeUpload(
  docs: Docs,
  req: FastifyRequest,
  input: UploadInput,
): Promise<{ file: DocsFile; created: boolean }> {
  const { ctx, store } = docs;
  const { temp } = input;
  const sameUpload = (f: DocsFile) => f.projectId === input.projectId && f.sha256 === temp.sha256;
  const existing = await getFile(ctx.db, input.id);
  if (existing) {
    await store.discard(temp);
    if (!sameUpload(existing)) throw ctx.errors.conflict('Ez a fájlazonosító már egy másik fájlhoz tartozik');
    return { file: existing, created: false };
  }

  let created = false;
  try {
    await ctx.db.transaction(async (tx) => {
      // Az upsert zárolja a blob sorát; ha egy párhuzamos törlés épp eltávolítja, megvárja, és új sort szúr be.
      const [blob] = await tx
        .insert(docsBlobs)
        .values({ sha256: temp.sha256, size: temp.size })
        .onConflictDoUpdate({ target: docsBlobs.sha256, set: { sha256: sql`excluded.sha256` } })
        .returning();
      await store.commit(temp);
      let hasThumb = blob!.hasThumb;
      if (!hasThumb && canThumb(input.mime)) {
        hasThumb = await makeThumb(store.blobPath(temp.sha256), store.thumbPath(temp.sha256));
        if (hasThumb) await tx.update(docsBlobs).set({ hasThumb }).where(eq(docsBlobs.sha256, temp.sha256));
      }

      const [row] = await tx
        .insert(docsFiles)
        .values({
          id: input.id,
          projectId: input.projectId,
          folderId: input.folderId,
          sha256: temp.sha256,
          name: input.name,
          mime: input.mime,
          size: temp.size,
          uploadedBy: req.user!.id,
        })
        .onConflictDoNothing()
        .returning();
      // Ugyanaz az azonosító közben egy párhuzamos kérésből került be.
      if (!row) return;

      const eventId = await ctx.appendEvent(
        {
          projectId: input.projectId,
          type: DOCS_EVENTS.fileUploaded,
          source: 'user',
          title: `${isImage(row.mime) ? 'Fotó feltöltve' : 'Fájl feltöltve'}: ${row.name}`,
          actorId: req.user!.id,
          data: { ...eventData(row, hasThumb) },
          parentId: input.parentEventId,
        },
        tx,
      );
      await tx.update(docsFiles).set({ eventId }).where(eq(docsFiles.id, row.id));
      await ctx.audit(req, { action: 'create', entity: 'file', entityId: row.id, label: row.name, projectId: row.projectId }, tx);
      created = true;
    });
  } finally {
    // Ha a tranzakció a blob végleges helyre tétele előtt hiúsult meg, az ideiglenes fájl itt törlődik.
    await store.discard(temp);
  }

  const file = (await getFile(ctx.db, input.id))!;
  if (!created && !sameUpload(file)) throw ctx.errors.conflict('Ez a fájlazonosító már egy másik fájlhoz tartozik');
  return { file, created };
}

/**
 * A fájl metaadat-sorának törlése. Ha a blobra már egy sor sem hivatkozik, a blob sora is törlődik, a lemezen lévő
 * fájl és a bélyegkép pedig a tranzakció sikere után (addig a `trash/` alatt várnak, hiba esetén visszakerülnek).
 */
export async function deleteFile(docs: Docs, req: FastifyRequest, fileId: string): Promise<void> {
  const { ctx, store } = docs;
  let trash: Awaited<ReturnType<BlobStore['moveToTrash']>> | undefined;
  try {
    await ctx.db.transaction(async (tx) => {
      const [row] = await tx.delete(docsFiles).where(eq(docsFiles.id, fileId)).returning();
      if (!row) throw ctx.errors.notFound('A fájl nem található');
      const [blob] = await tx.select().from(docsBlobs).where(eq(docsBlobs.sha256, row.sha256)).for('update');
      const [refs] = await tx.select({ n: count() }).from(docsFiles).where(eq(docsFiles.sha256, row.sha256));
      const lastReference = refs!.n === 0;
      if (lastReference) await tx.delete(docsBlobs).where(eq(docsBlobs.sha256, row.sha256));

      await ctx.appendEvent(
        {
          projectId: row.projectId,
          type: DOCS_EVENTS.fileDeleted,
          source: 'user',
          title: `${isImage(row.mime) ? 'Fotó törölve' : 'Fájl törölve'}: ${row.name}`,
          actorId: req.user!.id,
          data: { ...eventData(row, false) },
        },
        tx,
      );
      await ctx.audit(req, { action: 'delete', entity: 'file', entityId: row.id, label: row.name, projectId: row.projectId }, tx);
      // Utolsó lépés a véglegesítés előtt: a zárolt blob-sor miatt egy párhuzamos feltöltés addig vár.
      if (lastReference && blob) trash = await store.moveToTrash(row.sha256);
    });
  } catch (err) {
    await trash?.restore();
    throw err;
  }
  await trash?.finish();
}

/** Átnevezés vagy áthelyezés más mappába, verziószám-ellenőrzéssel (eltérésnél 409). */
export async function updateFile(
  docs: Docs,
  req: FastifyRequest,
  current: DocsFile,
  patch: { version: number; name?: string; folderId?: string | null },
): Promise<DocsFile> {
  const { ctx } = docs;
  if (patch.folderId !== undefined) await requireFolderIn(docs, current.projectId, patch.folderId);
  await ctx.db.transaction(async (tx: Tx) => {
    const [row] = await tx
      .update(docsFiles)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        version: sql`${docsFiles.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(docsFiles.id, current.id), eq(docsFiles.version, patch.version)))
      .returning();
    if (!row) throw ctx.errors.conflict('A fájlt közben más módosította; töltsd újra az oldalt');
    await ctx.audit(req, { action: 'update', entity: 'file', entityId: row.id, label: row.name, projectId: row.projectId, data: { from: current.name } }, tx);
  });
  return (await getFile(ctx.db, current.id))!;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505';

export async function createFolder(
  docs: Docs,
  req: FastifyRequest,
  projectId: string,
  input: { name: string; parentId?: string | null },
): Promise<DocsFolder> {
  const { ctx } = docs;
  await requireFolderIn(docs, projectId, input.parentId);
  try {
    const [row] = await ctx.db
      .insert(docsFolders)
      .values({ projectId, parentId: input.parentId ?? null, name: input.name, createdBy: req.user!.id })
      .returning();
    return toFolderDto(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw ctx.errors.conflict('Ezen a helyen már van ilyen nevű mappa');
    throw err;
  }
}

export async function renameFolder(docs: Docs, folder: DocsFolder, input: { version: number; name: string }): Promise<DocsFolder> {
  const { ctx } = docs;
  try {
    const [row] = await ctx.db
      .update(docsFolders)
      .set({ name: input.name, version: sql`${docsFolders.version} + 1` })
      .where(and(eq(docsFolders.id, folder.id), eq(docsFolders.version, input.version)))
      .returning();
    if (!row) throw ctx.errors.conflict('A mappát közben más módosította; töltsd újra az oldalt');
    return toFolderDto(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw ctx.errors.conflict('Ezen a helyen már van ilyen nevű mappa');
    throw err;
  }
}

/** Csak üres mappa törölhető (se fájl, se almappa); különben 409. */
export async function deleteFolder(docs: Docs, folder: DocsFolder): Promise<void> {
  const { ctx } = docs;
  await ctx.db.transaction(async (tx) => {
    await tx.select({ id: docsFolders.id }).from(docsFolders).where(eq(docsFolders.id, folder.id)).for('update');
    const [files] = await tx.select({ n: count() }).from(docsFiles).where(eq(docsFiles.folderId, folder.id));
    const [children] = await tx.select({ n: count() }).from(docsFolders).where(eq(docsFolders.parentId, folder.id));
    if (files!.n > 0 || children!.n > 0) throw ctx.errors.conflict('Csak üres mappa törölhető');
    await tx.delete(docsFolders).where(eq(docsFolders.id, folder.id));
  });
}

/** A szülő-esemény ugyanebben a projektben van-e (különben 400). */
export async function requireParentEvent(docs: Docs, projectId: string, eventId: string | undefined): Promise<string | null> {
  if (!eventId) return null;
  const res = await docs.ctx.pool.query<{ project_id: string | null }>('SELECT project_id FROM events WHERE id = $1', [eventId]);
  if (res.rows[0]?.project_id !== projectId) throw docs.ctx.errors.badRequest('A szülő-esemény nem ehhez a projekthez tartozik');
  return eventId;
}
