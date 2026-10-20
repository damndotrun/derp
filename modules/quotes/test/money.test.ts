import { describe, expect, it } from 'vitest';
import { formatFiller, parseDecimal, parseFtToFiller } from '../shared/format.ts';
import { lineNetFiller, quoteTotals, type MoneyLine } from '../shared/money.ts';

const line = (quantity: number, netUnitPriceFiller: number, vatRate = 27, discountPercent = 0): MoneyLine => ({
  quantity,
  netUnitPriceFiller,
  vatRate,
  discountPercent,
});

describe('tétel nettó értéke', () => {
  it('a seed 2 150,50 Ft-os tétele: 3 m = 6 451,50 Ft, 2,5 m = 5 376,25 Ft', () => {
    expect(lineNetFiller(line(3, 215_050))).toBe(645_150);
    expect(lineNetFiller(line(2.5, 215_050))).toBe(537_625);
  });

  it('tört mennyiségnél és kedvezménynél fillérre kerekít, fél felfelé', () => {
    // 0,333 × 2 150,50 = 716,1165 Ft → 716,12 Ft
    expect(lineNetFiller(line(0.333, 215_050))).toBe(71_612);
    // 1 × 0,05 Ft × 50% = 0,025 Ft → 0,03 Ft (fél felfelé)
    expect(lineNetFiller(line(1, 5, 27, 50))).toBe(3);
    // 7 × 2 150,50 Ft × (1 − 12,5%) = 13 171,8125 Ft → 13 171,81 Ft
    expect(lineNetFiller(line(7, 215_050, 27, 12.5))).toBe(1_317_181);
    expect(lineNetFiller(line(2, 4_850_000, 27, 100))).toBe(0);
  });

  it('lebegőpontos hiba nélkül (0,1 + 0,2 jellegű mennyiségek)', () => {
    expect(lineNetFiller(line(0.3, 10_000))).toBe(3_000);
    expect(lineNetFiller(line(1.005, 100_000))).toBe(100_500);
  });
});

describe('összesítés', () => {
  it('a seed három cikke és egy kézi tétel: ÁFA a kulcs nettó összegére, a végösszeg forintra kerekítve', () => {
    const t = quoteTotals([
      line(2, 4_850_000), // Csőventilátor: 97 000,00
      line(3, 215_050), // Légcsatorna: 6 451,50
      line(4, 399_000), // Befúvó rács: 15 960,00
      line(1, 2_500_000, 27, 10), // kézi tétel (szerelés) 10% kedvezménnyel: 22 500,00
    ]);
    expect(t.lineNetFiller).toEqual([9_700_000, 645_150, 1_596_000, 2_250_000]);
    expect(t.byVatRate).toEqual([{ vatRate: 27, netFiller: 14_191_150, vatFiller: 3_831_611, grossFiller: 18_022_761 }]);
    // 141 911,50 × 27% = 38 316,105 → 38 316,11; bruttó 180 227,61 → 180 228 Ft
    expect(t).toMatchObject({ netFiller: 14_191_150, vatFiller: 3_831_611, grossFiller: 18_022_761, totalFiller: 18_022_800, roundingFiller: 39 });
    expect(formatFiller(t.totalFiller)).toMatch(/^180\s228\sFt$/);
  });

  it('ÁFA-kulcsonkénti bontás: csökkenő kulcs szerint, kulcsonként külön kerekítve', () => {
    const t = quoteTotals([line(1, 101), line(1, 1_000_000, 5), line(1, 333, 27), line(2, 12_345, 0), line(1, 999, 18)]);
    expect(t.byVatRate).toEqual([
      // 4,34 Ft × 27% = 1,1718 → 1,17
      { vatRate: 27, netFiller: 434, vatFiller: 117, grossFiller: 551 },
      { vatRate: 18, netFiller: 999, vatFiller: 180, grossFiller: 1_179 },
      { vatRate: 5, netFiller: 1_000_000, vatFiller: 50_000, grossFiller: 1_050_000 },
      { vatRate: 0, netFiller: 24_690, vatFiller: 0, grossFiller: 24_690 },
    ]);
    expect(t.netFiller).toBe(434 + 999 + 1_000_000 + 24_690);
    expect(t.vatFiller).toBe(117 + 180 + 50_000);
    expect(t.grossFiller).toBe(1_076_420);
    // 10 764,20 Ft → 10 764 Ft (lefelé), kerekítés −0,20 Ft
    expect(t).toMatchObject({ totalFiller: 1_076_400, roundingFiller: -20 });
  });

  it('a végösszeg kerekítése fél felfelé: x,50 Ft → felfelé, x,49 Ft → lefelé', () => {
    // 50 fillér bruttó 0%-kal
    expect(quoteTotals([line(1, 50, 0)]).totalFiller).toBe(100);
    expect(quoteTotals([line(1, 49, 0)]).totalFiller).toBe(0);
    expect(quoteTotals([line(1, 1_234_550, 0)]).totalFiller).toBe(1_234_600);
  });

  it('üres ajánlat: minden nulla', () => {
    expect(quoteTotals([])).toEqual({
      lineNetFiller: [],
      byVatRate: [],
      netFiller: 0,
      vatFiller: 0,
      grossFiller: 0,
      totalFiller: 0,
      roundingFiller: 0,
    });
  });
});

describe('magyar számbevitel', () => {
  it('forint fillérre', () => {
    expect(parseFtToFiller('2 150,50')).toBe(215_050);
    expect(parseFtToFiller('2150,5')).toBe(215_050);
    expect(parseFtToFiller('1.234,50 Ft')).toBe(123_450);
    expect(parseFtToFiller('48500')).toBe(4_850_000);
    expect(parseFtToFiller('2150.50')).toBe(215_050);
    expect(parseFtToFiller('1.234')).toBe(123_400);
    expect(parseFtToFiller('48 500 Ft')).toBe(4_850_000);
    expect(parseFtToFiller('1,234')).toBeNull();
    expect(parseFtToFiller('-5')).toBeNull();
    expect(parseFtToFiller('')).toBeNull();
    expect(parseFtToFiller('sok')).toBeNull();
  });

  it('mennyiség és kedvezmény', () => {
    expect(parseDecimal('2,5', 3)).toBe(2.5);
    expect(parseDecimal('0,333', 3)).toBe(0.333);
    expect(parseDecimal('0,3333', 3)).toBeNull();
    expect(parseDecimal('12,5%', 2)).toBe(12.5);
  });
});
