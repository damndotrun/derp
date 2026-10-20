import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { FolderList, FolderQuery, MappingList, MappingSet, ProjectWatch, RelPath, ScanResult, TestWatchFile, type WatchMapping } from '../shared.ts';
import { listFolders, realRoot, resolveInside, toRel, watchIntervalSec, watchRoot, WatchFsError } from './fs.ts';
import { fileCounts, forgetFiles, Scanner, scanProject } from './scanner.ts';
import { watchFiles, watchMappings } from './schema.ts';

type MappingRow = typeof watchMappings.$inferSelect;

const toMapping = (m: MappingRow, fileCount: number): WatchMapping => ({
  projectId: m.projectId,
  path: m.path,
  version: m.version,
  createdAt: m.createdAt.toISOString(),
  lastScanAt: m.lastScanAt?.toISOString() ?? null,
  lastError: m.lastError,
  fileCount,
});

/** Content-Disposition fejléc ékezetes névvel (RFC 6266 / 5987) és ASCII tartalékkal. */
export function contentDisposition(name: string): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505';

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const root = watchRoot(process.env, ctx.config.nodeEnv);
  const scanner = new Scanner(ctx, root);
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Ütemezett bejárás WATCH_INTERVAL_SEC szerint; ha az előző még fut, a mostani kimarad.
  const intervalSec = watchIntervalSec();
  if (intervalSec > 0) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      scanner
        .scanAll()
        .then((results) => {
          for (const [projectId, res] of results) if (res.error) app.log.warn({ projectId, error: res.error }, 'watch: a bejárás nem sikerült');
        })
        .catch((err: Error) => app.log.error({ err }, 'watch: ütemezett bejárás'))
        .finally(() => (running = false));
    }, intervalSec * 1000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  // Leállításkor a futó bejárás még befejeződik, mielőtt az adatbázis-kapcsolat bezárul.
  app.addHook('onClose', async () => scanner.exclusive(async () => undefined));

  const projectParams = z.object({ projectId: z.uuid() });

  const getMapping = async (projectId: string) =>
    (await ctx.db.select().from(watchMappings).where(eq(watchMappings.projectId, projectId)))[0] ?? null;

  const projectWatch = async (projectId: string): Promise<ProjectWatch> => {
    const mapping = await getMapping(projectId);
    if (!mapping) return { mapping: null, files: [] };
    const files = await ctx.db
      .select({ id: watchFiles.id, projectId: watchFiles.projectId, path: watchFiles.path, size: watchFiles.size, mtime: watchFiles.mtime })
      .from(watchFiles)
      .where(and(eq(watchFiles.projectId, projectId), isNull(watchFiles.deletedAt)))
      .orderBy(watchFiles.path);
    return {
      mapping: toMapping(mapping, files.length),
      files: files.map((f) => ({ ...f, mtime: f.mtime.toISOString() })),
    };
  };

  /** A felhasználó által látható projektek hozzárendelései (a terepesnek csak a hozzá rendelt projekteké). */
  r.get('/api/watch/mappings', { schema: { response: { 200: MappingList } } }, async (req) => {
    const visible = await ctx.visibleProjectIds(req);
    const { rows } = await ctx.pool.query<{ project_id: string }>(
      `SELECT m.project_id FROM watch_mappings m JOIN projects p ON p.id = m.project_id
       WHERE p.deleted_at IS NULL AND ($1::uuid[] IS NULL OR m.project_id = ANY($1::uuid[]))`,
      [visible],
    );
    const ids = rows.map((x) => x.project_id);
    if (ids.length === 0) return { items: [] };
    const mappings = await ctx.db.select().from(watchMappings).where(inArray(watchMappings.projectId, ids)).orderBy(watchMappings.path);
    const counts = await fileCounts(ctx, ids);
    return { items: mappings.map((m) => toMapping(m, counts.get(m.projectId) ?? 0)) };
  });

  r.get('/api/watch/projects/:projectId', { schema: { params: projectParams, response: { 200: ProjectWatch } } }, async (req) => {
    const project = await ctx.requireProject(req, req.params.projectId);
    return projectWatch(project.id);
  });

  // Almappa hozzárendelése vagy cseréje. A meglévő fájlok esemény nélkül kerülnek be (alapállapot); az ezutáni
  // változások lesznek események. Csere esetén a korábbi almappa fájljai esemény nélkül kikerülnek.
  r.put(
    '/api/watch/projects/:projectId/mapping',
    { preHandler: ctx.requirePermission('watch.manage'), schema: { params: projectParams, body: MappingSet, response: { 200: ProjectWatch } } },
    async (req) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      return scanner.exclusive(async () => {
        let rel: string;
        try {
          const abs = await resolveInside(root, req.body.path);
          if (!(await lstat(abs)).isDirectory()) throw new WatchFsError(`Ez nem mappa: ${req.body.path}`);
          rel = toRel(await realRoot(root), abs);
        } catch (err) {
          if (err instanceof WatchFsError) throw ctx.errors.badRequest(err.message);
          throw err;
        }
        if (rel === '') throw ctx.errors.badRequest('A figyelt gyökér egésze nem rendelhető egy projekthez; válassz almappát');

        const existing = await getMapping(project.id);
        if (req.body.version !== (existing?.version ?? undefined)) {
          throw ctx.errors.conflict('A hozzárendelést közben más módosította; töltsd újra az oldalt');
        }
        if (existing?.path === rel) return projectWatch(project.id);
        const [taken] = await ctx.pool
          .query<{ name: string }>(
            `SELECT p.name FROM watch_mappings m JOIN projects p ON p.id = m.project_id WHERE m.path = $1 AND m.project_id <> $2`,
            [rel, project.id],
          )
          .then((res) => res.rows);
        if (taken) throw ctx.errors.conflict(`Ez a mappa már a(z) „${taken.name}” projekthez tartozik`);

        try {
          await ctx.db.transaction(async (tx) => {
            await forgetFiles(tx, project.id);
            if (existing) {
              const [row] = await tx
                .update(watchMappings)
                .set({ path: rel, version: existing.version + 1, lastScanAt: null, lastError: null })
                .where(and(eq(watchMappings.projectId, project.id), eq(watchMappings.version, existing.version)))
                .returning();
              if (!row) throw ctx.errors.conflict('A hozzárendelést közben más módosította; töltsd újra az oldalt');
            } else {
              await tx.insert(watchMappings).values({ projectId: project.id, path: rel, createdBy: req.user!.id });
            }
            await ctx.audit(
              req,
              { action: existing ? 'update' : 'create', entity: 'mapping', entityId: project.id, label: rel, projectId: project.id, data: existing ? { from: existing.path } : undefined },
              tx,
            );
          });
        } catch (err) {
          if (isUniqueViolation(err)) throw ctx.errors.conflict('Ez a mappa már egy másik projekthez tartozik');
          throw err;
        }
        const baseline = await scanProject(ctx, root, project.id, { baseline: true });
        if (baseline.error) req.log.warn({ projectId: project.id, error: baseline.error }, 'watch: az alapállapot bejárása nem sikerült');
        return projectWatch(project.id);
      });
    },
  );

  r.delete(
    '/api/watch/projects/:projectId/mapping',
    { preHandler: ctx.requirePermission('watch.manage'), schema: { params: projectParams } },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      await scanner.exclusive(async () => {
        const existing = await getMapping(project.id);
        if (!existing) throw ctx.errors.notFound('Ehhez a projekthez nincs hozzárendelt mappa');
        await ctx.db.transaction(async (tx) => {
          await forgetFiles(tx, project.id);
          await tx.delete(watchMappings).where(eq(watchMappings.projectId, project.id));
          await ctx.audit(req, { action: 'delete', entity: 'mapping', entityId: project.id, label: existing.path, projectId: project.id }, tx);
        });
      });
      return reply.code(204).send();
    },
  );

  // „Most ellenőrizd”: a projekt almappájának azonnali bejárása.
  r.post(
    '/api/watch/projects/:projectId/scan',
    { preHandler: ctx.requirePermission('watch.scan'), schema: { params: projectParams, response: { 200: ScanResult } } },
    async (req) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      if (!(await getMapping(project.id))) throw ctx.errors.notFound('Ehhez a projekthez nincs hozzárendelt mappa');
      return scanner.scan(project.id);
    },
  );

  // A figyelt gyökér böngészése a hozzárendeléshez.
  r.get(
    '/api/watch/folders',
    { preHandler: ctx.requirePermission('watch.manage'), schema: { querystring: FolderQuery, response: { 200: FolderList } } },
    async (req) => {
      const raw = req.query.path?.trim() ?? '';
      const parsed = raw.replace(/^\/+|\/+$/g, '') === '' ? null : RelPath.safeParse(raw);
      if (parsed && !parsed.success) throw ctx.errors.badRequest('Érvénytelen útvonal');
      let base: string;
      let names: string[];
      let current: string;
      try {
        base = await realRoot(root);
        const dir = parsed ? await resolveInside(root, parsed.data) : base;
        current = toRel(base, dir);
        names = await listFolders(dir);
      } catch (err) {
        if (err instanceof WatchFsError) throw ctx.errors.notFound(err.message);
        throw err;
      }
      const paths = names.map((n) => (current ? `${current}/${n}` : n));
      const owners = new Map<string, { id: string; name: string }>();
      if (paths.length) {
        const { rows } = await ctx.pool.query<{ path: string; id: string; name: string }>(
          `SELECT m.path, p.id, p.name FROM watch_mappings m JOIN projects p ON p.id = m.project_id WHERE m.path = ANY($1::text[])`,
          [paths],
        );
        for (const row of rows) owners.set(row.path, { id: row.id, name: row.name });
      }
      return { path: current, folders: names.map((name, i) => ({ name, path: paths[i]!, project: owners.get(paths[i]!) ?? null })) };
    },
  );

  // Letöltés: a fájl a szerver-mappából, ahogy most van (a hozzárendelt almappán belül).
  r.get('/api/watch/files/:fileId/content', { schema: { params: z.object({ fileId: z.uuid() }) } }, async (req, reply) => {
    const [file] = await ctx.db.select().from(watchFiles).where(eq(watchFiles.id, req.params.fileId));
    if (!file) throw ctx.errors.notFound('A fájl nem található');
    await ctx.requireProject(req, file.projectId);
    const mapping = await getMapping(file.projectId);
    if (file.deletedAt || !mapping) throw ctx.errors.notFound('A fájl már nincs a szerveren');
    let abs: string;
    try {
      const dir = await resolveInside(root, mapping.path);
      abs = await realpath(path.join(dir, ...file.path.split('/')));
      if (!abs.startsWith(dir + path.sep) || !(await lstat(abs)).isFile()) throw new Error('kívül esik');
    } catch {
      throw ctx.errors.notFound('A fájl már nincs a szerveren');
    }
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    await ctx.audit(req, { action: 'view', entity: 'file', entityId: file.id, label: file.path, projectId: file.projectId });
    reply
      .type('application/octet-stream')
      .header('content-disposition', contentDisposition(name))
      .header('cache-control', 'private, no-cache')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox");
    return reply.send(createReadStream(abs));
  });

  // Csak teszt módban: fájl írása a WATCH_ROOT alá (az e2e-hez; élesben a mount csak olvasható, és a végpont nincs).
  if (ctx.config.nodeEnv === 'test') {
    r.post('/api/test/watch-file', { schema: { body: TestWatchFile } }, async (req, reply) => {
      await mkdir(root, { recursive: true });
      const base = await realRoot(root);
      const target = path.join(base, ...req.body.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      const parent = await realpath(path.dirname(target));
      if (parent !== base && !parent.startsWith(base + path.sep)) throw ctx.errors.badRequest('Érvénytelen útvonal');
      await writeFile(target, Buffer.from(req.body.content, req.body.encoding));
      return reply.code(201).send({ path: req.body.path });
    });
  }
}
