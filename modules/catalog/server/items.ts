import { and, asc, count, eq, inArray, like, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@derp/server/module-api';
import { searchKey } from '../shared/format.ts';
import {
  PREVIEW_ERROR_ROWS,
  PREVIEW_OK_ROWS,
  type CatalogItem,
  type CatalogList,
  type ImportField,
  type ImportPreview,
  type ImportRow,
  type ImportSummary,
  type ImportValues,
} from '../shared/schemas.ts';
import { itemSearchText, type ParsedCsv } from './csv.ts';
import { item } from './schema.ts';

type Reader = Pick<Db, 'select'>;
type Writer = Pick<Db, 'insert'>;
type ItemRow = typeof item.$inferSelect;

const toDto = (r: ItemRow): CatalogItem => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  unit: r.unit,
  netUnitPriceFiller: r.netUnitPriceFiller,
  vatRate: r.vatRate,
  supplier: r.supplier,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/** Keresés: minden szónak szerepelnie kell a cikkszámban, a megnevezésben vagy a beszállítóban (ékezettől függetlenül). */
export async function listItems(db: Reader, q: { q?: string; limit: number; offset: number }): Promise<CatalogList> {
  const words = searchKey(q.q ?? '').split(' ').filter(Boolean);
  const where: SQL | undefined = words.length ? and(...words.map((w) => like(item.searchText, `%${escapeLike(w)}%`))) : undefined;
  const [rows, [total]] = await Promise.all([
    db.select().from(item).where(where).orderBy(asc(item.name), asc(item.sku)).limit(q.limit).offset(q.offset),
    db.select({ n: count() }).from(item).where(where),
  ]);
  return { items: rows.map(toDto), total: total?.n ?? 0 };
}

export async function getItem(db: Reader, id: string): Promise<CatalogItem | null> {
  const [row] = await db.select().from(item).where(eq(item.id, id));
  return row ? toDto(row) : null;
}

const COMPARED: Exclude<ImportField, 'sku'>[] = ['name', 'unit', 'netUnitPriceFiller', 'vatRate', 'supplier'];
const CHUNK = 1000;

/** A beolvasott sorok összevetése a meglévő cikkekkel (cikkszám szerint): új, módosul (mely mezők), változatlan, hibás. */
export async function planImport(db: Reader, parsed: ParsedCsv): Promise<ImportRow[]> {
  const skus = parsed.rows.flatMap((r) => ('values' in r ? [r.values.sku] : []));
  const existing = new Map<string, ItemRow>();
  for (let i = 0; i < skus.length; i += CHUNK) {
    for (const row of await db.select().from(item).where(inArray(item.sku, skus.slice(i, i + CHUNK)))) existing.set(row.sku, row);
  }
  return parsed.rows.map((r): ImportRow => {
    if (!('values' in r)) return { line: r.line, status: 'error', raw: r.raw, errors: r.errors };
    const old = existing.get(r.values.sku);
    if (!old) return { line: r.line, status: 'new', values: r.values };
    const changed = COMPARED.filter((f) => old[f] !== r.values[f]);
    return changed.length ? { line: r.line, status: 'changed', values: r.values, changed } : { line: r.line, status: 'unchanged', values: r.values };
  });
}

export function summarize(rows: ImportRow[]): ImportSummary {
  const s: ImportSummary = { new: 0, changed: 0, unchanged: 0, error: 0 };
  for (const r of rows) s[r.status]++;
  return s;
}

/** Az előnézet válasza: a hibás sorok előre, utánuk a többi, mindkettő korlátozva (a `summary` mindet számolja). */
export function previewOf(parsed: ParsedCsv, rows: ImportRow[]): ImportPreview {
  const errors = rows.filter((r) => r.status === 'error');
  const ok = rows.filter((r) => r.status !== 'error');
  const shown = [...errors.slice(0, PREVIEW_ERROR_ROWS), ...ok.slice(0, PREVIEW_OK_ROWS)];
  return {
    fileError: parsed.fileError,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    summary: summarize(rows),
    rows: shown,
    omitted: rows.length - shown.length,
  };
}

/**
 * Cikkek felvétele vagy frissítése cikkszám szerint. Ahol egyik mező sem változott, a sor érintetlen marad (a verzió
 * sem nő), így a seed és az ismételt import is megismételhető.
 */
export async function upsertItems(db: Writer, values: ImportValues[]): Promise<void> {
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(item)
      .values(values.slice(i, i + CHUNK).map((v) => ({ ...v, searchText: itemSearchText(v) })))
      .onConflictDoUpdate({
        target: item.sku,
        set: {
          name: sql`excluded.name`,
          unit: sql`excluded.unit`,
          netUnitPriceFiller: sql`excluded.net_unit_price_filler`,
          vatRate: sql`excluded.vat_rate`,
          supplier: sql`excluded.supplier`,
          searchText: sql`excluded.search_text`,
          version: sql`${item.version} + 1`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`(${item.name}, ${item.unit}, ${item.netUnitPriceFiller}, ${item.vatRate}, ${item.supplier})
          IS DISTINCT FROM (excluded.name, excluded.unit, excluded.net_unit_price_filler, excluded.vat_rate, excluded.supplier)`,
      });
  }
}
