import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { DocsFile, DocsFolder, FileUpdate, FolderCreate, FolderUpdate, MAX_UPLOAD_BYTES, ProjectDocs, UploadQuery } from '../shared.ts';
import { BlobStore, TooLargeError } from './blob-store.ts';
import {
  createFolder,
  deleteFile,
  deleteFolder,
  getFile,
  getFolder,
  listProjectDocs,
  renameFolder,
  requireFolderIn,
  requireParentEvent,
  storeUpload,
  updateFile,
  type Docs,
} from './files.ts';
import { isInline, resolveMime } from './mime.ts';
import { MANAGE_ROLES } from './permissions.ts';

/** A fájltár gyökere: `DATA_DIR` (alapérték `/data/files`, a spec konfigurációs táblája szerint). */
export const dataDir = (env: NodeJS.ProcessEnv = process.env): string => env.DATA_DIR || '/data/files';

const tooLarge = (message: string) => Object.assign(new Error(message), { statusCode: 413 });

/** Content-Disposition fejléc ékezetes névvel (RFC 6266 / 5987) és ASCII tartalékkal. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const store = new BlobStore(dataDir());
  // Ha a DATA_DIR nem írható, a szerver attól még elindul (a többi modul működjön); a feltöltés ad hibát.
  await store.init().catch((err: Error) => app.log.error({ err, dataDir: store.root }, 'docs: a DATA_DIR nem hozható létre'));
  const docs: Docs = { ctx, store };
  const r = app.withTypeProvider<ZodTypeProvider>();

  // A feltöltés törzse nyers bájtfolyam; a modul hatókörén belül marad, a mag JSON-feldolgozását nem érinti.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  /** A fájl, ha a projektjét a felhasználó láthatja (a projektre 404/403 a mag szerint). */
  const visibleFile = async (req: FastifyRequest, id: string): Promise<DocsFile> => {
    const file = await getFile(ctx.db, id);
    if (!file) throw ctx.errors.notFound('A fájl nem található');
    await ctx.requireProject(req, file.projectId);
    return file;
  };
  const visibleFolder = async (req: FastifyRequest, id: string): Promise<DocsFolder> => {
    const folder = await getFolder(ctx.db, id);
    if (!folder) throw ctx.errors.notFound('A mappa nem található');
    await ctx.requireProject(req, folder.projectId);
    return folder;
  };
  /** Törlés, átnevezés, áthelyezés: az irodai szerepkörök bármelyik fájlnál, más a saját feltöltésénél. */
  const requireModify = (req: FastifyRequest, file: DocsFile) => {
    const user = req.user!;
    if (!MANAGE_ROLES.includes(user.role) && file.uploadedBy?.id !== user.id) throw ctx.errors.forbidden('Csak a saját feltöltésedet módosíthatod');
  };

  const fileParams = z.object({ fileId: z.uuid() });
  const folderParams = z.object({ folderId: z.uuid() });
  const projectParams = z.object({ projectId: z.uuid() });

  r.get('/api/docs/projects/:projectId', { schema: { params: projectParams, response: { 200: ProjectDocs } } }, async (req) => {
    const project = await ctx.requireProject(req, req.params.projectId);
    return listProjectDocs(ctx.db, project.id);
  });

  r.put(
    '/api/docs/projects/:projectId/files/:fileId',
    {
      preHandler: ctx.requirePermission('docs.upload'),
      schema: { params: projectParams.extend({ fileId: z.uuid() }), querystring: UploadQuery, response: { 200: DocsFile, 201: DocsFile } },
    },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      const q = req.query;
      await requireFolderIn(docs, project.id, q.folderId);
      const parentEventId = await requireParentEvent(docs, project.id, q.parentEventId);
      const source = req.body instanceof Readable ? req.body : Readable.from([]);
      let temp;
      try {
        temp = await store.writeTemp(source, MAX_UPLOAD_BYTES);
      } catch (err) {
        if (err instanceof TooLargeError) throw tooLarge(err.message);
        throw err;
      }
      if (q.sha256 && q.sha256 !== temp.sha256) {
        await store.discard(temp);
        throw ctx.errors.badRequest('A fájl sérülten érkezett (az sha256 nem egyezik); próbáld újra');
      }
      const { file, created } = await storeUpload(docs, req, {
        id: req.params.fileId,
        projectId: project.id,
        folderId: q.folderId ?? null,
        name: q.name,
        mime: resolveMime(q.type, q.name),
        temp,
        parentEventId,
        capturedAt: q.capturedAt,
      });
      return reply.code(created ? 201 : 200).send(file);
    },
  );

  r.get('/api/docs/files/:fileId', { schema: { params: fileParams, response: { 200: DocsFile } } }, async (req) =>
    visibleFile(req, req.params.fileId),
  );

  const sendBlob = (req: FastifyRequest, reply: FastifyReply, etag: string, path: string) => {
    reply.header('etag', etag).header('x-content-type-options', 'nosniff');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.send(createReadStream(path));
  };

  r.get(
    '/api/docs/files/:fileId/content',
    { schema: { params: fileParams, querystring: z.object({ download: z.enum(['0', '1']).optional() }) } },
    async (req, reply) => {
      const file = await visibleFile(req, req.params.fileId);
      await ctx.audit(req, { action: 'view', entity: 'file', entityId: file.id, label: file.name, projectId: file.projectId });
      const inline = isInline(file.mime) && req.query.download !== '1';
      reply
        .type(file.mime)
        .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', file.name))
        .header('cache-control', 'private, no-cache');
      // A feltöltött tartalom ne futtathasson szkriptet az alkalmazás címén (a PDF-néző a sandboxot nem viseli).
      if (file.mime !== 'application/pdf') {
        reply.header('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      }
      return sendBlob(req, reply, `"${file.sha256}"`, store.blobPath(file.sha256));
    },
  );

  r.get('/api/docs/files/:fileId/thumb', { schema: { params: fileParams } }, async (req, reply) => {
    const file = await visibleFile(req, req.params.fileId);
    if (!file.hasThumb) throw ctx.errors.notFound('Ehhez a fájlhoz nincs bélyegkép');
    reply.type('image/webp').header('cache-control', 'private, max-age=3600');
    return sendBlob(req, reply, `"t-${file.sha256}"`, store.thumbPath(file.sha256));
  });

  r.patch('/api/docs/files/:fileId', { schema: { params: fileParams, body: FileUpdate, response: { 200: DocsFile } } }, async (req) => {
    const file = await visibleFile(req, req.params.fileId);
    requireModify(req, file);
    return updateFile(docs, req, file, req.body);
  });

  r.delete('/api/docs/files/:fileId', { schema: { params: fileParams } }, async (req, reply) => {
    const file = await visibleFile(req, req.params.fileId);
    requireModify(req, file);
    await deleteFile(docs, req, file.id);
    return reply.code(204).send();
  });

  r.post(
    '/api/docs/projects/:projectId/folders',
    { preHandler: ctx.requirePermission('docs.upload'), schema: { params: projectParams, body: FolderCreate, response: { 201: DocsFolder } } },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      return reply.code(201).send(await createFolder(docs, req, project.id, req.body));
    },
  );

  r.patch(
    '/api/docs/folders/:folderId',
    { preHandler: ctx.requirePermission('docs.manage'), schema: { params: folderParams, body: FolderUpdate, response: { 200: DocsFolder } } },
    async (req) => renameFolder(docs, await visibleFolder(req, req.params.folderId), req.body),
  );

  r.delete(
    '/api/docs/folders/:folderId',
    { preHandler: ctx.requirePermission('docs.manage'), schema: { params: folderParams } },
    async (req, reply) => {
      await deleteFolder(docs, await visibleFolder(req, req.params.folderId));
      return reply.code(204).send();
    },
  );
}
