import { describe, expect, it } from 'vitest';
import { decodeCsv, detectDelimiter, headerField, parseCatalogCsv, parsePrice, parseVat } from '../server/csv.ts';

/** Windows-1250 kódolás a magyar betűkre (a magyar Excel „CSV (pontosvesszővel tagolt)” mentése ilyen). */
const CP1250: Record<string, number> = {
  á: 0xe1, é: 0xe9, í: 0xed, ó: 0xf3, ö: 0xf6, ő: 0xf5, ú: 0xfa, ü: 0xfc, ű: 0xfb,
  Á: 0xc1, É: 0xc9, Í: 0xcd, Ó: 0xd3, Ö: 0xd6, Ő: 0xd5, Ú: 0xda, Ü: 0xdc, Ű: 0xdb, '×': 0xd7,
};
const cp1250 = (s: string) => Uint8Array.from([...s].map((c) => CP1250[c] ?? c.charCodeAt(0)));
const utf8 = (s: string, bom = false) => new Uint8Array([...(bom ? [0xef, 0xbb, 0xbf] : []), ...new TextEncoder().encode(s)]);

const HEADER = 'Cikkszám;Megnevezés;Egység;Nettó egységár;ÁFA-kulcs;Beszállító';
const ACCENTS = 'Árvíztűrő tükörfúrógép ŐŰÖÜ őűöü';

describe('magyar ékezetek', () => {
  const csv = `${HEADER}\r\nAT-1;${ACCENTS};db;1 000;27;Hűtő-Fűtő Kft.\r\n`;

  it.each([
    ['UTF-8 BOM-mal', utf8(csv, true), 'UTF-8'],
    ['UTF-8 BOM nélkül', utf8(csv), 'UTF-8'],
    ['Windows-1250 (magyar Excel)', cp1250(csv), 'Windows-1250'],
  ])('%s: a megnevezés és a fejléc ékezetei épen maradnak', (_, bytes, encoding) => {
    const parsed = parseCatalogCsv(bytes);
    expect(parsed.fileError).toBeNull();
    expect(parsed.encoding).toBe(encoding);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        values: { sku: 'AT-1', name: ACCENTS, unit: 'db', netUnitPriceFiller: 100_000, vatRate: 27, supplier: 'Hűtő-Fűtő Kft.' },
      },
    ]);
  });

  it('UTF-16 BOM-mal (Excel „Unicode szöveg”, tabulátorral tagolt)', () => {
    const text = `${HEADER}\r\nAT-1;${ACCENTS};db;1 000;27;\r\n`.replaceAll(';', '\t');
    const bytes = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Buffer.from(text, 'utf16le'))]);
    expect(decodeCsv(bytes)).toEqual({ text, encoding: 'UTF-16' });
    const parsed = parseCatalogCsv(bytes);
    expect(parsed.delimiter).toBe('\t');
    expect(parsed.rows[0]).toMatchObject({ values: { name: ACCENTS } });
  });

  it('a fejléc kis-nagybetűtől, ékezettől, írásjeltől és „(Ft)” végződéstől függetlenül ismert', () => {
    expect(headerField('CIKKSZAM')).toBe('sku');
    expect(headerField('Nettó egységár (Ft)')).toBe('netUnitPriceFiller');
    expect(headerField('afa %')).toBe('vatRate');
    expect(headerField('Mértékegység')).toBe('unit');
    expect(headerField('Megjegyzés')).toBeUndefined();
  });
});

describe('vesszős tizedes', () => {
  it.each([
    ['1234,50', 123_450],
    ['1 234,50', 123_450],
    ['1 234,5', 123_450],
    ['1.234,50', 123_450],
    ['12,5 Ft', 1250],
    ['0,99', 99],
    ['48 500', 4_850_000],
    ['1.234.567', 123_456_700],
    ['1234.50', 123_450],
    ['12,500', 1250],
    ['0', 0],
  ])('%s → %i fillér', (input, filler) => {
    expect(parsePrice(input)).toEqual({ filler });
  });

  it.each(['abc', '12,345', '-5', '1,2,3', '12.34.5', ''])('%s → hiba', (input) => {
    expect(parsePrice(input)).toHaveProperty('error');
  });

  it('az elválasztó a fejlécből jön, ezért a vesszős tizedes nem vágja szét a sort', () => {
    expect(detectDelimiter(`${HEADER}\n1;a;db;1,5;27;`)).toBe(';');
    expect(detectDelimiter('Cikkszám,Megnevezés,Egység,Nettó egységár,ÁFA-kulcs\n1,a,db,"1,5",27')).toBe(',');
    const parsed = parseCatalogCsv(utf8('Cikkszám,Megnevezés,Egység,Nettó egységár,ÁFA-kulcs\nK-1,"Bilincs, horganyzott",db,"12,50",27\n'));
    expect(parsed.rows).toEqual([
      { line: 2, values: { sku: 'K-1', name: 'Bilincs, horganyzott', unit: 'db', netUnitPriceFiller: 1250, vatRate: 27, supplier: '' } },
    ]);
  });

  it('ÁFA-kulcs: 27, „27%”, „27,0”; más érték hiba', () => {
    expect(parseVat('27')).toEqual({ rate: 27 });
    expect(parseVat('27 %')).toEqual({ rate: 27 });
    expect(parseVat('5,0')).toEqual({ rate: 5 });
    expect(parseVat('0')).toEqual({ rate: 0 });
    expect(parseVat('25')).toHaveProperty('error');
    expect(parseVat('AAM')).toHaveProperty('error');
  });
});

describe('hibás sor', () => {
  const csv = [
    HEADER,
    'OK-1;Jó cikk;db;100;27;',
    ';Cikkszám nélkül;db;100;27;',
    'H-2;Rossz ár;db;sok;27;',
    'H-3;Rossz ÁFA;db;100;25;',
    '',
    'OK-1;Ugyanaz a cikkszám;db;100;27;',
    'H-4;Több mező;db;100;27;Beszállító;fölösleges',
    'H-5;"Kétsoros',
    'megnevezés";db;-1;;',
    'OK-2;Másik jó cikk;m;2 150,00;27;Nagyker',
  ].join('\r\n');
  const parsed = parseCatalogCsv(utf8(csv));

  it('a hibás sor a fájlbeli sorszámmal és okkal jelenik meg, a jó sorok megmaradnak', () => {
    expect(parsed.fileError).toBeNull();
    expect(parsed.rows.map((r) => [r.line, 'values' in r ? 'ok' : r.errors])).toEqual([
      [2, 'ok'],
      [3, ['Hiányzik a cikkszám']],
      [4, ['A nettó egységár nem szám: „sok”']],
      [5, ['Ismeretlen ÁFA-kulcs: „25” (lehet: 0, 5, 18, 27)']],
      [7, ['A(z) „OK-1” cikkszám már szerepel a(z) 2. sorban']],
      [8, [expect.stringContaining('Több mező van a sorban (7), mint oszlop a fejlécben (6)')]],
      [9, ['A nettó egységár nem lehet negatív', 'Hiányzik az ÁFA-kulcs']],
      [11, 'ok'],
    ]);
  });

  it('a hibás sor nyers mezői is látszanak az előnézethez', () => {
    expect(parsed.rows[2]).toMatchObject({ raw: ['H-2', 'Rossz ár', 'db', 'sok', '27', ''] });
  });

  it('hiányzó kötelező oszlop esetén a fájl egésze hibás', () => {
    const p = parseCatalogCsv(utf8('Cikkszám;Megnevezés;Ár\nX;Y;1\n'));
    expect(p.fileError).toMatch(/^Hiányzó oszlop a fejlécben: Egység, Nettó egységár, ÁFA-kulcs\./);
    expect(p.rows).toEqual([]);
    expect(parseCatalogCsv(utf8('')).fileError).toBe('A fájl üres');
  });
});
