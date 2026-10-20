import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { LOGO_MAX_BYTES, LogoUpload, PdfRequest, Quote, QuoteList, QuotePdf, Settings, SettingsUpdate, StatusChange, VersionUpdate } from '../shared/schemas.ts';
import {
  changeStatus,
  createPdf,
  createQuote,
  createVersion,
  findQuoteProject,
  findVersion,
  getPdf,
  getQuote,
  listQuotes,
  updateVersion,
} from './quotes.ts';
import { getLogo, getSettings, setLogo, updateSettings } from './settings.ts';

const ProjectParams = z.object({ projectId: z.uuid() });
const QuoteParams = z.object({ quoteId: z.uuid() });
const VersionParams = z.object({ versionId: z.uuid() });

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Az ajánlatokat (az árak miatt) csak az iroda és az admin látja és szerkeszti; a terepes minden végponton 403.
  const manage = ctx.requirePermission('quotes.manage');
  const settingsAdmin = ctx.requirePermission('quotes.settings');

  const quoteOf = async (req: Parameters<typeof ctx.requireProject>[0], quoteId: string) => {
    const projectId = await findQuoteProject(ctx.pool, quoteId);
    if (!projectId) throw ctx.errors.notFound('Az ajánlat nem található');
    await ctx.requireProject(req, projectId);
    const quote = await getQuote(ctx.pool, quoteId);
    if (!quote) throw ctx.errors.notFound('Az ajánlat nem található');
    return quote;
  };
  const versionOf = async (req: Parameters<typeof ctx.requireProject>[0], versionId: string) => {
    const found = await findVersion(ctx.pool, versionId);
    if (!found) throw ctx.errors.notFound('Az ajánlatverzió nem található');
    await ctx.requireProject(req, found.projectId);
    return found;
  };

  r.get('/api/quotes', { preHandler: manage, schema: { response: { 200: QuoteList } } }, async () => ({ items: await listQuotes(ctx.pool) }));

  r.get('/api/quotes/projects/:projectId', { preHandler: manage, schema: { params: ProjectParams, response: { 200: QuoteList } } }, async (req) => {
    const project = await ctx.requireProject(req, req.params.projectId);
    return { items: await listQuotes(ctx.pool, project.id) };
  });

  // Új ajánlat egy üres tervezettel.
  r.post('/api/quotes/projects/:projectId', { preHandler: manage, schema: { params: ProjectParams, response: { 201: Quote } } }, async (req, reply) => {
    const project = await ctx.requireProject(req, req.params.projectId);
    const id = await createQuote(ctx, req, project.id);
    return reply.code(201).send((await getQuote(ctx.pool, id))!);
  });

  r.get('/api/quotes/:quoteId', { preHandler: manage, schema: { params: QuoteParams, response: { 200: Quote } } }, async (req) =>
    quoteOf(req, req.params.quoteId),
  );

  // Új verzió a legújabb (már nem tervezet) verzió másolataként.
  r.post('/api/quotes/:quoteId/versions', { preHandler: manage, schema: { params: QuoteParams, response: { 201: Quote } } }, async (req, reply) => {
    await quoteOf(req, req.params.quoteId);
    await createVersion(ctx, req, req.params.quoteId);
    return reply.code(201).send((await getQuote(ctx.pool, req.params.quoteId))!);
  });

  r.put(
    '/api/quotes/versions/:versionId',
    { preHandler: manage, schema: { params: VersionParams, body: VersionUpdate, response: { 200: Quote } } },
    async (req) => {
      const { quoteId } = await versionOf(req, req.params.versionId);
      await updateVersion(ctx, req, req.params.versionId, req.body);
      return (await getQuote(ctx.pool, quoteId))!;
    },
  );

  r.post(
    '/api/quotes/versions/:versionId/status',
    { preHandler: manage, schema: { params: VersionParams, body: StatusChange, response: { 200: Quote } } },
    async (req) => {
      const { quoteId } = await versionOf(req, req.params.versionId);
      await changeStatus(ctx, req, req.params.versionId, req.body);
      return (await getQuote(ctx.pool, quoteId))!;
    },
  );

  r.post(
    '/api/quotes/versions/:versionId/pdf',
    { preHandler: manage, schema: { params: VersionParams, body: PdfRequest, response: { 201: QuotePdf } } },
    async (req, reply) => {
      const { quoteId } = await versionOf(req, req.params.versionId);
      const pdfId = await createPdf(ctx, req, req.params.versionId, req.body.revision);
      const quote = (await getQuote(ctx.pool, quoteId))!;
      return reply.code(201).send(quote.versions.flatMap((v) => v.pdfs).find((p) => p.id === pdfId)!);
    },
  );

  r.get('/api/quotes/pdfs/:pdfId', { preHandler: manage, schema: { params: z.object({ pdfId: z.uuid() }) } }, async (req, reply) => {
    const pdf = await getPdf(ctx.pool, req.params.pdfId);
    if (!pdf) throw ctx.errors.notFound('A PDF nem található');
    await ctx.requireProject(req, pdf.projectId);
    await ctx.audit(req, { action: 'view', entity: 'pdf', entityId: req.params.pdfId, label: pdf.fileName, projectId: pdf.projectId });
    return reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="${pdf.fileName}"`)
      .header('cache-control', 'private, max-age=0')
      .send(pdf.content);
  });

  // A PDF fejléce: olvasni az iroda is tudja (a szerkesztő előnézetéhez), írni csak az admin.
  r.get('/api/quotes/settings', { preHandler: manage, schema: { response: { 200: Settings } } }, async () => getSettings(ctx.db));

  r.put('/api/quotes/settings', { preHandler: settingsAdmin, schema: { body: SettingsUpdate, response: { 200: Settings } } }, async (req) =>
    updateSettings(ctx, req, req.body),
  );

  r.get('/api/quotes/settings/logo', { preHandler: manage }, async (_req, reply) => {
    const logo = await getLogo(ctx.db);
    if (!logo) throw ctx.errors.notFound('Nincs feltöltött logó');
    return reply.type(logo.mime).header('cache-control', 'private, no-cache').send(logo.data);
  });

  r.put(
    '/api/quotes/settings/logo',
    { bodyLimit: Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4096, preHandler: settingsAdmin, schema: { body: LogoUpload, response: { 200: Settings } } },
    async (req) => setLogo(ctx, req, req.body),
  );

  r.delete('/api/quotes/settings/logo', { preHandler: settingsAdmin, schema: { response: { 200: Settings } } }, async (req) => setLogo(ctx, req, null));
}
