import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../../catalog/shared/schemas.ts';
import { catalogRow, draftTotals, isDirty, manualRow, parseRow, toDraft, toUpdate } from './editor.ts';

const cso: CatalogItem = {
  id: '3f0c2b9e-5d1a-4c1e-9a7b-2f4d6e8a0b1c',
  sku: 'LT-CSO-125',
  name: 'Spirálkorcolt légcsatorna Ø125 mm',
  unit: 'm',
  netUnitPriceFiller: 215_050,
  vatRate: 27,
  supplier: 'Légtechnika Nagyker Kft.',
  version: 1,
  updatedAt: '2026-10-20T10:00:00.000Z',
};

describe('a szerkesztő sorai', () => {
  it('a cikktörzs cikke a tételbe másolódik, az ár magyar formában szerkeszthető', () => {
    const row = catalogRow(cso, 3);
    expect(row).toMatchObject({ catalogItemId: cso.id, sku: 'LT-CSO-125', name: cso.name, unit: 'm', quantity: '3', price: '2150,50', vatRate: 27, discount: '0' });
    expect(parseRow(row).item).toMatchObject({ quantity: 3, netUnitPriceFiller: 215_050, discountPercent: 0 });
    expect(draftTotals([row]).totalFiller).toBe(819_300);
  });

  it('a hibás mezőket jelzi; a hibás sor 0 Ft-tal számít, mentés nincs', () => {
    const row = { ...manualRow({ name: 'Szerelés', quantity: 1, unit: 'klt' }), price: 'sok', discount: '120' };
    expect(parseRow(row).errors).toEqual(['price', 'discount']);
    expect(parseRow({ ...row, name: ' ', quantity: '0', price: '1', discount: '' }).errors).toEqual(['name', 'quantity']);
    const good = { ...row, price: '25 000', discount: '10' };
    expect(draftTotals([row, catalogRow(cso, 3)]).totalFiller).toBe(819_300);
    expect(toUpdate({ rows: [row], note: '', validUntil: '' }, 1)).toBeNull();
    expect(toUpdate({ rows: [good], note: ' Megjegyzés ', validUntil: '2026-11-30' }, 4)).toEqual({
      revision: 4,
      items: [expect.objectContaining({ name: 'Szerelés', unit: 'klt', quantity: 1, netUnitPriceFiller: 2_500_000, discountPercent: 10, catalogItemId: null, sku: '' })],
      note: 'Megjegyzés',
      validUntil: '2026-11-30',
    });
  });

  it('a mentett állapothoz képest csak a tényleges változás számít módosításnak', () => {
    const item = parseRow(catalogRow(cso, 2.5)).item!;
    const saved = toDraft({ items: [item], note: '', validUntil: null });
    expect(saved.rows[0]).toMatchObject({ quantity: '2,5', price: '2150,50' });
    expect(isDirty({ ...saved, rows: [{ ...saved.rows[0]!, price: '2 150,5' }] }, saved)).toBe(false);
    expect(isDirty({ ...saved, rows: [{ ...saved.rows[0]!, quantity: '3' }] }, saved)).toBe(true);
    expect(isDirty({ ...saved, note: 'x' }, saved)).toBe(true);
  });
});
