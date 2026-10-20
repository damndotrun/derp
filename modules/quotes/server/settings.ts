import type { FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { Db, ModuleContext } from '@derp/server/module-api';
import type { LogoUpload, Settings, SettingsUpdate } from '../shared/schemas.ts';
import type { PdfCompany } from './pdf.ts';
import { settings } from './schema.ts';

// A PDF fejléce (a cég adatai és a logó). A magban nincs beállítás-tár, ezért a `quotes` modul saját, egysoros
// táblája (`quotes_settings`), amelyet az admin szerkeszt.

type Reader = Pick<Db, 'select'>;
type Row = typeof settings.$inferSelect;

const toDto = (r: Row): Settings => ({
  version: r.version,
  companyName: r.companyName,
  address: r.address,
  taxNumber: r.taxNumber,
  phone: r.phone,
  email: r.email,
  bankAccount: r.bankAccount,
  footer: r.footer,
  hasLogo: r.logo !== null,
  updatedAt: r.updatedAt.toISOString(),
});

async function row(db: Reader): Promise<Row> {
  const [r] = await db.select().from(settings).where(eq(settings.id, 1));
  return r!;
}

export const getSettings = async (db: Reader) => toDto(await row(db));

export async function pdfCompany(db: Reader): Promise<PdfCompany> {
  const r = await row(db);
  return {
    companyName: r.companyName,
    address: r.address,
    taxNumber: r.taxNumber,
    phone: r.phone,
    email: r.email,
    bankAccount: r.bankAccount,
    footer: r.footer,
    logo: r.logo && r.logoMime ? { mime: r.logoMime, data: r.logo } : null,
  };
}

export async function getLogo(db: Reader): Promise<{ mime: string; data: Buffer } | null> {
  const r = await row(db);
  return r.logo && r.logoMime ? { mime: r.logoMime, data: r.logo } : null;
}

const audit = (ctx: ModuleContext, req: FastifyRequest, data: Record<string, unknown>, tx: Parameters<ModuleContext['audit']>[2]) =>
  ctx.audit(req, { action: 'update', entity: 'settings', entityId: '00000000-0000-4000-8000-000000000001', label: 'PDF-fejléc', data }, tx);

/** A cég adatainak mentése; eltérő `version`-nél 409. */
export async function updateSettings(ctx: ModuleContext, req: FastifyRequest, body: SettingsUpdate): Promise<Settings> {
  return ctx.db.transaction(async (tx) => {
    const { version, ...fields } = body;
    const [r] = await tx
      .update(settings)
      .set({ ...fields, version: sql`${settings.version} + 1`, updatedAt: sql`now()` })
      .where(sql`${settings.id} = 1 AND ${settings.version} = ${version}`)
      .returning();
    if (!r) throw ctx.errors.conflict('A beállításokat közben módosították; töltsd újra az oldalt');
    await audit(ctx, req, { fields: Object.keys(fields) }, tx);
    return toDto(r);
  });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** Logó feltöltése (PNG vagy JPEG; a tartalomnak egyeznie kell a megadott típussal) vagy törlése (`null`). */
export async function setLogo(ctx: ModuleContext, req: FastifyRequest, upload: LogoUpload | null): Promise<Settings> {
  let data: Buffer | null = null;
  if (upload) {
    data = Buffer.from(upload.content, 'base64');
    const magic = upload.mime === 'image/png' ? PNG : JPEG;
    if (data.length === 0 || !data.subarray(0, magic.length).equals(magic)) {
      throw ctx.errors.badRequest('A logó nem érvényes PNG vagy JPEG kép');
    }
  }
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .update(settings)
      .set({ logo: data, logoMime: upload?.mime ?? null, version: sql`${settings.version} + 1`, updatedAt: sql`now()` })
      .where(eq(settings.id, 1))
      .returning();
    await audit(ctx, req, { logo: upload ? `${upload.mime}, ${data!.length} bájt` : 'törölve' }, tx);
    return toDto(r!);
  });
}
