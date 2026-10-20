import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { CatalogItem, CatalogList, CatalogListQuery, ImportPreview, ImportRequest, ImportResult, IMPORT_MAX_BYTES } from '../shared/schemas.ts';
import { parseCatalogCsv } from './csv.ts';
import { getItem, listItems, planImport, previewOf, summarize, upsertItems } from './items.ts';

const IdParams = z.object({ id: z.uuid() });
/** A base64 a fájlnál kb. 4/3-szor nagyobb, plusz a JSON-keret. */
const bodyLimit = Math.ceil(IMPORT_MAX_BYTES / 3) * 4 + 64 * 1024;

const bytesOf = (content: string) => new Uint8Array(Buffer.from(content, 'base64'));

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = ctx.requirePermission('catalog.manage');

  r.get('/api/catalog/items', { schema: { querystring: CatalogListQuery, response: { 200: CatalogList } } }, async (req) =>
    listItems(ctx.db, req.query),
  );

  r.get('/api/catalog/items/:id', { schema: { params: IdParams, response: { 200: CatalogItem } } }, async (req) => {
    const found = await getItem(ctx.db, req.params.id);
    if (!found) throw ctx.errors.notFound('A cikk nem található');
    return found;
  });

  // Előnézet: a fájl beolvasva és összevetve a cikktörzzsel; semmi nem íródik.
  r.post(
    '/api/catalog/import/preview',
    { bodyLimit, preHandler: manage, schema: { body: ImportRequest, response: { 200: ImportPreview } } },
    async (req) => {
      const parsed = parseCatalogCsv(bytesOf(req.body.content));
      return previewOf(parsed, parsed.fileError ? [] : await planImport(ctx.db, parsed));
    },
  );

  // Import: ugyanaz a fájl újra beolvasva; a hibás sorok kimaradnak, az új cikkek felkerülnek, a módosulók frissülnek.
  r.post(
    '/api/catalog/import',
    { bodyLimit, preHandler: manage, schema: { body: ImportRequest, response: { 200: ImportResult } } },
    async (req) => {
      const parsed = parseCatalogCsv(bytesOf(req.body.content));
      if (parsed.fileError) throw ctx.errors.badRequest(parsed.fileError);
      const summary = await ctx.db.transaction(async (tx) => {
        // Egyszerre egy import: a tervezés és az írás között más ne módosítson.
        await tx.execute(sql`LOCK TABLE catalog_item IN SHARE ROW EXCLUSIVE MODE`);
        const rows = await planImport(tx, parsed);
        await upsertItems(
          tx,
          rows.flatMap((row) => (row.status === 'new' || row.status === 'changed' ? [row.values] : [])),
        );
        const s = summarize(rows);
        await ctx.audit(
          req,
          { action: 'update', entity: 'import', entityId: randomUUID(), label: req.body.fileName || 'CSV', data: { ...s } },
          tx,
        );
        return s;
      });
      return { summary };
    },
  );
}
