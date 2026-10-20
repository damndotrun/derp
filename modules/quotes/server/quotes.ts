import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db, ModuleContext } from '@derp/server/module-api';
import { quoteRef } from '../shared/format.ts';
import { quoteTotals } from '../shared/money.ts';
import {
  QUOTES_EVENTS,
  type PdfEventData,
  type Quote,
  type QuoteEventData,
  type QuoteItem,
  type QuotePdf,
  type QuoteStatus,
  type QuoteSummary,
  type QuoteVersion,
  type StatusEventData,
  type VersionUpdate,
} from '../shared/schemas.ts';
import { pdfFileName, renderQuotePdf } from './pdf.ts';
import { pdfs, quotes, versions } from './schema.ts';
import { pdfCompany } from './settings.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  tervezet: 'Tervezet',
  kikuldve: 'Kiküldve',
  elfogadva: 'Elfogadva',
  elutasitva: 'Elutasítva',
};

// A JSONB nem őrzi meg a kulcsok sorrendjét, ezért a tételt mindig ugyanabban az alakban adjuk vissza.
const item = (i: QuoteItem): QuoteItem => ({
  id: i.id,
  catalogItemId: i.catalogItemId,
  sku: i.sku,
  name: i.name,
  unit: i.unit,
  quantity: Number(i.quantity),
  netUnitPriceFiller: Number(i.netUnitPriceFiller),
  vatRate: i.vatRate,
  discountPercent: Number(i.discountPercent),
});

interface QuoteRow {
  id: string;
  project_id: string;
  project_name: string;
  client_name: string | null;
  number: number;
  created_at: Date;
  created_by: string;
  created_by_name: string;
}

interface VersionRow {
  id: string;
  quote_id: string;
  version_no: number;
  status: QuoteStatus;
  revision: number;
  items: QuoteItem[];
  note: string;
  valid_until: string | null;
  created_at: Date;
  created_by: string;
  created_by_name: string;
  updated_at: Date;
}

interface PdfRow {
  id: string;
  version_id: string;
  file_name: string;
  size: number;
  revision: number;
  total_filler: string;
  created_at: Date;
  created_by: string;
  created_by_name: string;
}

const SELECT_QUOTES = `
  SELECT q.id, q.project_id, p.name AS project_name, c.name AS client_name, q.number, q.created_at, q.created_by,
         u.name AS created_by_name
  FROM quotes_quotes q
  JOIN projects p ON p.id = q.project_id
  LEFT JOIN clients c ON c.id = p.client_id
  JOIN users u ON u.id = q.created_by`;

const toPdf = (r: PdfRow): QuotePdf => ({
  id: r.id,
  fileName: r.file_name,
  size: Number(r.size),
  revision: r.revision,
  totalFiller: Number(r.total_filler),
  createdAt: r.created_at.toISOString(),
  createdBy: { id: r.created_by, name: r.created_by_name },
});

const toVersion = (r: VersionRow, pdfRows: PdfRow[]): QuoteVersion => {
  const items = r.items.map(item);
  return {
    id: r.id,
    quoteId: r.quote_id,
    versionNo: r.version_no,
    status: r.status,
    revision: r.revision,
    items,
    note: r.note,
    validUntil: r.valid_until,
    totals: quoteTotals(items),
    pdfs: pdfRows.filter((p) => p.version_id === r.id).map(toPdf),
    createdAt: r.created_at.toISOString(),
    createdBy: { id: r.created_by, name: r.created_by_name },
    updatedAt: r.updated_at.toISOString(),
  };
};

/** Egy ajánlat minden verziójával és a PDF-ek adataival (a PDF tartalma nélkül). */
export async function getQuote(pool: pg.Pool, id: string): Promise<Quote | null> {
  const q = await pool.query<QuoteRow>(`${SELECT_QUOTES} WHERE q.id = $1 AND p.deleted_at IS NULL`, [id]);
  const row = q.rows[0];
  if (!row) return null;
  const v = await pool.query<VersionRow>(
    `SELECT v.id, v.quote_id, v.version_no, v.status, v.revision, v.items, v.note, to_char(v.valid_until, 'YYYY-MM-DD') AS valid_until,
            v.created_at, v.created_by, u.name AS created_by_name, v.updated_at
     FROM quotes_versions v JOIN users u ON u.id = v.created_by
     WHERE v.quote_id = $1 ORDER BY v.version_no`,
    [id],
  );
  const p = await pool.query<PdfRow>(
    `SELECT f.id, f.version_id, f.file_name, octet_length(f.content) AS size, f.revision, f.total_filler, f.created_at,
            f.created_by, u.name AS created_by_name
     FROM quotes_pdfs f JOIN users u ON u.id = f.created_by JOIN quotes_versions v ON v.id = f.version_id
     WHERE v.quote_id = $1 ORDER BY f.created_at DESC, f.id DESC`,
    [id],
  );
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    clientName: row.client_name,
    number: row.number,
    createdAt: row.created_at.toISOString(),
    createdBy: { id: row.created_by, name: row.created_by_name },
    versions: v.rows.map((r) => toVersion(r, p.rows)),
  };
}

/** Az ajánlatok a legújabb verziójukkal (projektre szűrve, vagy minden nem törölt projektből), a legutóbb módosítottal kezdve. */
export async function listQuotes(pool: pg.Pool, projectId?: string): Promise<QuoteSummary[]> {
  const res = await pool.query<QuoteRow & { version_no: number; status: QuoteStatus; items: QuoteItem[]; updated_at: Date }>(
    `SELECT q.id, q.project_id, p.name AS project_name, c.name AS client_name, q.number, v.version_no, v.status, v.items, v.updated_at
     FROM quotes_quotes q
     JOIN projects p ON p.id = q.project_id
     LEFT JOIN clients c ON c.id = p.client_id
     JOIN LATERAL (
       SELECT version_no, status, items, updated_at FROM quotes_versions WHERE quote_id = q.id ORDER BY version_no DESC LIMIT 1
     ) v ON true
     WHERE p.deleted_at IS NULL AND ($1::uuid IS NULL OR q.project_id = $1)
     ORDER BY v.updated_at DESC, q.number DESC
     LIMIT 500`,
    [projectId ?? null],
  );
  return res.rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    clientName: r.client_name,
    number: r.number,
    versionNo: r.version_no,
    status: r.status,
    totalFiller: quoteTotals(r.items.map(item)).totalFiller,
    itemCount: r.items.length,
    updatedAt: r.updated_at.toISOString(),
  }));
}

/** A verzió és az ajánlata (a jogosultság-ellenőrzéshez a projekttel); `null`, ha nincs ilyen. */
export async function findVersion(pool: pg.Pool, versionId: string): Promise<{ quoteId: string; projectId: string } | null> {
  const res = await pool.query<{ quote_id: string; project_id: string }>(
    'SELECT v.quote_id, q.project_id FROM quotes_versions v JOIN quotes_quotes q ON q.id = v.quote_id WHERE v.id = $1',
    [versionId],
  );
  const r = res.rows[0];
  return r ? { quoteId: r.quote_id, projectId: r.project_id } : null;
}

export async function findQuoteProject(pool: pg.Pool, quoteId: string): Promise<string | null> {
  const res = await pool.query<{ project_id: string }>('SELECT project_id FROM quotes_quotes WHERE id = $1', [quoteId]);
  return res.rows[0]?.project_id ?? null;
}

const eventData = (q: { id: string; number: number }, v: { id: string; versionNo: number; status: QuoteStatus }): QuoteEventData => ({
  quoteId: q.id,
  versionId: v.id,
  number: q.number,
  versionNo: v.versionNo,
  status: v.status,
});

/** Új ajánlat a projekthez, egy üres tervezet verzióval; esemény az idővonalra. */
export async function createQuote(ctx: ModuleContext, req: FastifyRequest, projectId: string): Promise<string> {
  const user = req.user!;
  return ctx.db.transaction(async (tx) => {
    const [q] = await tx.insert(quotes).values({ projectId, createdBy: user.id }).returning();
    const [v] = await tx.insert(versions).values({ quoteId: q!.id, versionNo: 1, createdBy: user.id }).returning();
    const data = eventData(q!, v!);
    const eventId = await ctx.appendEvent(
      {
        projectId,
        type: QUOTES_EVENTS.created,
        source: 'user',
        title: `Árajánlat létrehozva: ${quoteRef(q!.number, 1)} (${STATUS_LABEL.tervezet})`,
        actorId: user.id,
        data: { ...data },
      },
      tx,
    );
    await tx.update(versions).set({ eventId }).where(eq(versions.id, v!.id));
    await ctx.audit(req, { action: 'create', entity: 'quote', entityId: q!.id, label: `Árajánlat ${quoteRef(q!.number, 1)}`, projectId }, tx);
    return q!.id;
  });
}

/** A verzió zárolva (a tranzakció végéig más nem módosíthatja) az ajánlatával együtt. */
async function lockVersion(ctx: ModuleContext, tx: Tx, versionId: string) {
  const [v] = await tx.select().from(versions).where(eq(versions.id, versionId)).for('update');
  if (!v) throw ctx.errors.notFound('Az ajánlatverzió nem található');
  const [q] = await tx.select().from(quotes).where(eq(quotes.id, v.quoteId));
  return { v, q: q! };
}

const staleError = (ctx: ModuleContext) => ctx.errors.conflict('Az ajánlatot közben módosították; töltsd újra az oldalt');
const lockedError = (ctx: ModuleContext) =>
  ctx.errors.conflict('A kiküldött ajánlat nem szerkeszthető; módosításhoz új verziót kell készíteni');

/** A tervezet mentése (tételek, megjegyzés, érvényesség). Csak tervezet szerkeszthető; eltérő `revision`-nél 409. */
export async function updateVersion(ctx: ModuleContext, req: FastifyRequest, versionId: string, body: VersionUpdate & { note: string; validUntil: string | null }) {
  await ctx.db.transaction(async (tx) => {
    const { v, q } = await lockVersion(ctx, tx, versionId);
    if (v.status !== 'tervezet') throw lockedError(ctx);
    if (v.revision !== body.revision) throw staleError(ctx);
    await tx
      .update(versions)
      .set({ items: body.items.map(item), note: body.note, validUntil: body.validUntil, revision: v.revision + 1, updatedAt: sql`now()` })
      .where(eq(versions.id, v.id));
    await ctx.audit(
      req,
      { action: 'update', entity: 'quote', entityId: q.id, label: `Árajánlat ${quoteRef(q.number, v.versionNo)}`, projectId: q.projectId },
      tx,
    );
  });
}

/** A PDF a zárolt verzió aktuális állapotáról; a tétel, az esemény és az audit a hívó tranzakciójában. */
async function writePdf(ctx: ModuleContext, req: FastifyRequest, tx: Tx, q: typeof quotes.$inferSelect, v: typeof versions.$inferSelect): Promise<string> {
  const user = req.user!;
  const project = await ctx.pool.query<{ name: string; client_name: string | null; client_address: string | null }>(
    `SELECT p.name, c.name AS client_name, c.address AS client_address
     FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1`,
    [q.projectId],
  );
  const p = project.rows[0]!;
  const items = v.items.map(item);
  const content = await renderQuotePdf(await pdfCompany(tx), {
    number: q.number,
    versionNo: v.versionNo,
    projectName: p.name,
    client: p.client_name === null ? null : { name: p.client_name, address: p.client_address ?? '' },
    items,
    note: v.note,
    validUntil: v.validUntil,
    issuedAt: new Date(),
    timeZone: ctx.config.tzDisplay,
  });
  const fileName = pdfFileName(q.number, v.versionNo);
  const [row] = await tx
    .insert(pdfs)
    .values({ versionId: v.id, revision: v.revision, fileName, content, totalFiller: quoteTotals(items).totalFiller, createdBy: user.id })
    .returning({ id: pdfs.id });
  const data: PdfEventData = { ...eventData(q, v), pdfId: row!.id, fileName };
  await ctx.appendEvent(
    {
      projectId: q.projectId,
      type: QUOTES_EVENTS.pdfCreated,
      source: 'user',
      title: `Árajánlat PDF elkészült: ${quoteRef(q.number, v.versionNo)}`,
      actorId: user.id,
      data: { ...data },
      parentId: v.eventId,
    },
    tx,
  );
  await ctx.audit(req, { action: 'create', entity: 'pdf', entityId: row!.id, label: fileName, projectId: q.projectId }, tx);
  return row!.id;
}

/** PDF a tervezetről, a megadott szerkesztett állapotról (eltérésnél 409). A kiküldött verzió PDF-je már megvan. */
export async function createPdf(ctx: ModuleContext, req: FastifyRequest, versionId: string, revision: number): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const { v, q } = await lockVersion(ctx, tx, versionId);
    if (v.status !== 'tervezet') throw ctx.errors.conflict('A kiküldött ajánlat PDF-je már elkészült; új PDF-hez új verzió kell');
    if (v.revision !== revision) throw staleError(ctx);
    if (v.items.length === 0) throw ctx.errors.badRequest('Tétel nélküli ajánlatból nem készül PDF');
    return writePdf(ctx, req, tx, q, v);
  });
}

/**
 * Kézi státuszváltás. A tervezetből bármelyik másik állapotba lehet lépni, tervezetbe vissza nem (a kiküldött ajánlat
 * nem szerkeszthető). A tervezet elhagyásakor, ha az aktuális állapotáról még nincs PDF, elkészül, így minden
 * kiküldött verziónak megmarad a PDF-je.
 */
export async function changeStatus(ctx: ModuleContext, req: FastifyRequest, versionId: string, body: { revision: number; status: QuoteStatus }) {
  const user = req.user!;
  await ctx.db.transaction(async (tx) => {
    const { v, q } = await lockVersion(ctx, tx, versionId);
    if (v.revision !== body.revision) throw staleError(ctx);
    if (v.status === body.status) throw ctx.errors.badRequest(`Az ajánlat már „${STATUS_LABEL[body.status]}” állapotú`);
    if (body.status === 'tervezet') throw lockedError(ctx);
    if (v.status === 'tervezet') {
      if (v.items.length === 0) throw ctx.errors.badRequest('Tétel nélküli ajánlat nem küldhető ki');
      const [current] = await tx
        .select({ id: pdfs.id })
        .from(pdfs)
        .where(and(eq(pdfs.versionId, v.id), eq(pdfs.revision, v.revision)))
        .limit(1);
      if (!current) await writePdf(ctx, req, tx, q, v);
    }
    await tx.update(versions).set({ status: body.status, revision: v.revision + 1, updatedAt: sql`now()` }).where(eq(versions.id, v.id));
    const data: StatusEventData = { ...eventData(q, { ...v, status: body.status }), from: v.status };
    await ctx.appendEvent(
      {
        projectId: q.projectId,
        type: QUOTES_EVENTS.statusChanged,
        source: 'user',
        title: `Árajánlat ${quoteRef(q.number, v.versionNo)}: ${STATUS_LABEL[body.status]}`,
        actorId: user.id,
        data: { ...data },
        parentId: v.eventId,
      },
      tx,
    );
    await ctx.audit(
      req,
      {
        action: 'update',
        entity: 'quote',
        entityId: q.id,
        label: `Árajánlat ${quoteRef(q.number, v.versionNo)}`,
        projectId: q.projectId,
        data: { status: body.status, from: v.status },
      },
      tx,
    );
  });
}

/**
 * Új verzió a legújabb verzió másolataként, tervezet állapotban. Csak akkor, ha a legújabb verzió már nem tervezet
 * (különben azt kell szerkeszteni): 409.
 */
export async function createVersion(ctx: ModuleContext, req: FastifyRequest, quoteId: string): Promise<void> {
  const user = req.user!;
  await ctx.db.transaction(async (tx) => {
    const [q] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for('update');
    if (!q) throw ctx.errors.notFound('Az ajánlat nem található');
    const [last] = await tx.select().from(versions).where(eq(versions.quoteId, q.id)).orderBy(desc(versions.versionNo)).limit(1);
    if (last!.status === 'tervezet') throw ctx.errors.conflict('Az ajánlatnak már van szerkeszthető tervezete');
    const [v] = await tx
      .insert(versions)
      .values({ quoteId: q.id, versionNo: last!.versionNo + 1, items: last!.items, note: last!.note, validUntil: last!.validUntil, createdBy: user.id })
      .returning();
    const eventId = await ctx.appendEvent(
      {
        projectId: q.projectId,
        type: QUOTES_EVENTS.versionCreated,
        source: 'user',
        title: `Új ajánlatverzió: ${quoteRef(q.number, v!.versionNo)} (${STATUS_LABEL.tervezet})`,
        actorId: user.id,
        data: { ...eventData(q, v!) },
      },
      tx,
    );
    await tx.update(versions).set({ eventId }).where(eq(versions.id, v!.id));
    await ctx.audit(
      req,
      { action: 'create', entity: 'version', entityId: v!.id, label: `Árajánlat ${quoteRef(q.number, v!.versionNo)}`, projectId: q.projectId },
      tx,
    );
  });
}

/** Egy PDF tartalma (letöltéshez) a projektjével. */
export async function getPdf(pool: pg.Pool, pdfId: string) {
  const res = await pool.query<{ file_name: string; content: Buffer; project_id: string }>(
    `SELECT f.file_name, f.content, q.project_id
     FROM quotes_pdfs f JOIN quotes_versions v ON v.id = f.version_id JOIN quotes_quotes q ON q.id = v.quote_id
     WHERE f.id = $1`,
    [pdfId],
  );
  const r = res.rows[0];
  return r ? { fileName: r.file_name, content: r.content, projectId: r.project_id } : null;
}

