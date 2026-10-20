// A tervezet szerkesztésének állapota: a beviteli mezők szövegként (magyar formában, „2 150,50”), a mentéshez és az
// élő összesítőhöz ebből lesz `QuoteItem`.
import type { CatalogItem } from '../../catalog/shared/schemas.ts';
import { decimalInput, fillerInput, parseDecimal, parseFtToFiller } from '../shared/format.ts';
import { quoteTotals, type QuoteTotals } from '../shared/money.ts';
import { MAX_QUANTITY, MAX_UNIT_PRICE_FILLER, type QuoteItem, type VersionUpdate } from '../shared/schemas.ts';

export type VatRate = QuoteItem['vatRate'];

export interface Row {
  id: string;
  catalogItemId: string | null;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  price: string;
  vatRate: VatRate;
  discount: string;
}

export type RowField = 'name' | 'unit' | 'quantity' | 'price' | 'discount';

export interface Draft {
  rows: Row[];
  note: string;
  validUntil: string;
}

export const DEFAULT_VAT: VatRate = 27;

export const toRow = (i: QuoteItem): Row => ({
  id: i.id,
  catalogItemId: i.catalogItemId,
  sku: i.sku,
  name: i.name,
  unit: i.unit,
  quantity: decimalInput(i.quantity, 3),
  price: fillerInput(i.netUnitPriceFiller),
  vatRate: i.vatRate,
  discount: decimalInput(i.discountPercent, 2),
});

/** A cikktörzs cikke tételként: a cikk adatai (megnevezés, egység, ár, ÁFA) a tételbe másolódnak. */
export const catalogRow = (c: CatalogItem, quantity = 1): Row => ({
  id: crypto.randomUUID(),
  catalogItemId: c.id,
  sku: c.sku,
  name: c.name,
  unit: c.unit,
  quantity: decimalInput(quantity, 3),
  price: fillerInput(c.netUnitPriceFiller),
  vatRate: c.vatRate,
  discount: '0',
});

export const manualRow = (init: { name?: string; quantity?: number; unit?: string } = {}): Row => ({
  id: crypto.randomUUID(),
  catalogItemId: null,
  sku: '',
  name: init.name ?? '',
  unit: init.unit ?? 'db',
  quantity: decimalInput(init.quantity ?? 1, 3),
  price: '',
  vatRate: DEFAULT_VAT,
  discount: '0',
});

/** Egy sor tételként, vagy a hibás mezők listája. */
export function parseRow(row: Row): { item: QuoteItem | null; errors: RowField[] } {
  const errors: RowField[] = [];
  const quantity = parseDecimal(row.quantity, 3);
  const price = parseFtToFiller(row.price);
  const discount = row.discount.trim() === '' ? 0 : parseDecimal(row.discount, 2);
  if (!row.name.trim() || row.name.trim().length > 500) errors.push('name');
  if (!row.unit.trim() || row.unit.trim().length > 20) errors.push('unit');
  if (quantity === null || quantity <= 0 || quantity > MAX_QUANTITY) errors.push('quantity');
  if (price === null || price > MAX_UNIT_PRICE_FILLER) errors.push('price');
  if (discount === null || discount > 100) errors.push('discount');
  if (errors.length) return { item: null, errors };
  return {
    item: {
      id: row.id,
      catalogItemId: row.catalogItemId,
      sku: row.sku,
      name: row.name.trim(),
      unit: row.unit.trim(),
      quantity: quantity!,
      netUnitPriceFiller: price!,
      vatRate: row.vatRate,
      discountPercent: discount!,
    },
    errors,
  };
}

/** Az élő összesítő: a még hibás sor 0 Ft-tal számít (a mentés úgyis csak hibátlanul megy). */
export function draftTotals(rows: Row[]): QuoteTotals {
  return quoteTotals(
    rows.map((r) => parseRow(r).item ?? { quantity: 0, netUnitPriceFiller: 0, vatRate: r.vatRate, discountPercent: 0 }),
  );
}

export function toDraft(v: { items: QuoteItem[]; note: string; validUntil: string | null }): Draft {
  return { rows: v.items.map(toRow), note: v.note, validUntil: v.validUntil ?? '' };
}

/** A mentés törzse, vagy `null`, ha van hibás sor. */
export function toUpdate(draft: Draft, revision: number): VersionUpdate | null {
  const items: QuoteItem[] = [];
  for (const r of draft.rows) {
    const { item } = parseRow(r);
    if (!item) return null;
    items.push(item);
  }
  return { revision, items, note: draft.note.trim(), validUntil: draft.validUntil || null };
}

/** Eltér-e a szerkesztett állapot a mentettől (a mezők szövege szerint, a formázási különbség nem számít). */
export function isDirty(draft: Draft, saved: Draft): boolean {
  const norm = (d: Draft) => JSON.stringify({ items: d.rows.map((r) => parseRow(r).item ?? r), note: d.note.trim(), validUntil: d.validUntil });
  return norm(draft) !== norm(saved);
}
