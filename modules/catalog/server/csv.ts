import Papa from 'papaparse';
import { searchKey } from '../shared/format.ts';
import { VAT_RATES, type ImportField, type ImportValues, type VatRate } from '../shared/schemas.ts';

// A cikktörzs CSV-importjának olvasója: kódolás-felismerés (UTF-8, UTF-16 BOM-mal, különben Windows-1250, a magyar
// Excel alapértelmezése), elválasztó a fejlécsorból (`;`, tabulátor vagy `,`), oszlopok a fejléc neve szerint,
// soronkénti ellenőrzés. Adatbázist nem ér; az összevetést a meglévő cikkekkel az `items.ts` végzi.

export const MAX_ROWS = 50_000;

const LIMITS = { sku: 64, name: 500, unit: 20, supplier: 200 } as const;
/** 10¹² Ft fölötti egységár biztosan elírás (és a fillér így még pontos egész szám marad). */
const MAX_PRICE_FILLER = 100_000_000_000_000;

export type ParsedRow = { line: number; values: ImportValues } | { line: number; raw: string[]; errors: string[] };

export interface ParsedCsv {
  fileError: string | null;
  encoding: string;
  delimiter: string;
  rows: ParsedRow[];
}

export function decodeCsv(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'Windows-1250' };
  }
}

/** Az elválasztó a fejlécsorból (abban nincs tizedesvessző): a leggyakoribb a `;`, tabulátor és `,` közül. */
export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let best = ';';
  let bestCount = 0;
  for (const d of [';', '\t', ',']) {
    const count = header.split(d).length - 1;
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

/** Fejlécnév → mező. A fejléc kis-nagybetűtől, ékezettől, szóköztől, írásjeltől és a „Ft”/„HUF” végződéstől függetlenül. */
const HEADER_ALIASES: Record<string, ImportField> = {
  cikkszam: 'sku',
  cikkkod: 'sku',
  termekkod: 'sku',
  megnevezes: 'name',
  termeknev: 'name',
  egyseg: 'unit',
  mertekegyseg: 'unit',
  me: 'unit',
  nettoegysegar: 'netUnitPriceFiller',
  nettoar: 'netUnitPriceFiller',
  egysegar: 'netUnitPriceFiller',
  afakulcs: 'vatRate',
  afa: 'vatRate',
  beszallito: 'supplier',
  szallito: 'supplier',
};

const FIELD_LABEL: Record<ImportField, string> = {
  sku: 'Cikkszám',
  name: 'Megnevezés',
  unit: 'Egység',
  netUnitPriceFiller: 'Nettó egységár',
  vatRate: 'ÁFA-kulcs',
  supplier: 'Beszállító',
};
const REQUIRED: ImportField[] = ['sku', 'name', 'unit', 'netUnitPriceFiller', 'vatRate'];

export function headerField(header: string): ImportField | undefined {
  const key = searchKey(header).replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] ?? HEADER_ALIASES[key.replace(/(ft|huf)$/, '')];
}

/**
 * Magyar formájú ár fillérben: „1 234,50”, „1.234,50”, „1234,5”, „12 Ft”; ha nincs benne vessző, a pont tizedespont
 * („1234.50”), kivéve ha ezres csoportokat választ el („1.234.567”).
 */
export function parsePrice(input: string): { filler: number } | { error: string } {
  const s = input.replace(/[\s  ]/g, '').replace(/(ft\.?|huf)$/i, '');
  const negative = s.startsWith('-');
  const digits = negative ? s.slice(1) : s;
  let intPart: string;
  let fracPart = '';
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(digits) || /^\d+(,\d+)?$/.test(digits)) {
    [intPart = '', fracPart = ''] = digits.replace(/\./g, '').split(',');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(digits)) {
    intPart = digits.replace(/\./g, '');
  } else if (/^\d+\.\d+$/.test(digits)) {
    [intPart = '', fracPart = ''] = digits.split('.');
  } else {
    return { error: `A nettó egységár nem szám: „${input.trim()}”` };
  }
  if (negative) return { error: 'A nettó egységár nem lehet negatív' };
  fracPart = fracPart.replace(/0+$/, '');
  if (fracPart.length > 2) return { error: `A nettó egységár legfeljebb 2 tizedesjegyű lehet (fillér): „${input.trim()}”` };
  const filler = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  if (filler > MAX_PRICE_FILLER) return { error: `A nettó egységár túl nagy: „${input.trim()}”` };
  return { filler };
}

/** ÁFA-kulcs százalékban: „27”, „27%”, „27 %”, „27,0”. */
export function parseVat(input: string): { rate: VatRate } | { error: string } {
  const m = /^(\d{1,3})(?:[.,]0+)?%?$/.exec(input.replace(/\s/g, ''));
  const rate = m ? Number(m[1]) : NaN;
  if (!(VAT_RATES as readonly number[]).includes(rate)) {
    return { error: `Ismeretlen ÁFA-kulcs: „${input.trim()}” (lehet: ${VAT_RATES.join(', ')})` };
  }
  return { rate: rate as VatRate };
}

function validateRow(get: (f: ImportField) => string): { values: ImportValues } | { errors: string[] } {
  const errors: string[] = [];
  const text = (f: 'sku' | 'name' | 'unit' | 'supplier', required: boolean, missing: string): string => {
    const v = get(f).replace(/\s+/g, ' ').trim();
    if (required && !v) errors.push(missing);
    else if (v.length > LIMITS[f]) errors.push(`${FIELD_LABEL[f]}: legfeljebb ${LIMITS[f]} karakter lehet`);
    return v;
  };
  const sku = text('sku', true, 'Hiányzik a cikkszám');
  const name = text('name', true, 'Hiányzik a megnevezés');
  const unit = text('unit', true, 'Hiányzik az egység');
  let netUnitPriceFiller = 0;
  if (!get('netUnitPriceFiller').trim()) errors.push('Hiányzik a nettó egységár');
  else {
    const p = parsePrice(get('netUnitPriceFiller'));
    if ('error' in p) errors.push(p.error);
    else netUnitPriceFiller = p.filler;
  }
  let vatRate: VatRate = 27;
  if (!get('vatRate').trim()) errors.push('Hiányzik az ÁFA-kulcs');
  else {
    const v = parseVat(get('vatRate'));
    if ('error' in v) errors.push(v.error);
    else vatRate = v.rate;
  }
  const supplier = text('supplier', false, '');
  return errors.length ? { errors } : { values: { sku, name, unit, netUnitPriceFiller, vatRate, supplier } };
}

/** A CSV-fájl olvasása és soronkénti ellenőrzése. A `line` a fájl sorszáma (a fejléc általában az 1.). */
export function parseCatalogCsv(bytes: Uint8Array): ParsedCsv {
  const { text, encoding } = decodeCsv(bytes);
  const delimiter = detectDelimiter(text);
  const result: ParsedCsv = { fileError: null, encoding, delimiter, rows: [] };

  // Sorszám a papaparse kurzorából (a rekord vége); az idézőjeles, többsoros mezők és az üres sorok miatt kell.
  const newlines: number[] = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) newlines.push(i);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid]! < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  const records: { line: number; fields: string[] }[] = [];
  let prevCursor = 0;
  let tooMany = false;
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: 'greedy',
    step: (r, parser) => {
      let start = prevCursor;
      while (start < text.length && /\s/.test(text[start]!)) start++;
      prevCursor = r.meta.cursor;
      if (records.length > MAX_ROWS) {
        tooMany = true;
        parser.abort();
        return;
      }
      records.push({ line: lineAt(start), fields: r.data });
    },
  });

  const header = records.shift();
  if (!header) return { ...result, fileError: 'A fájl üres' };
  if (tooMany) return { ...result, fileError: `A fájl legfeljebb ${MAX_ROWS} cikket tartalmazhat` };

  const columns = new Map<ImportField, number>();
  for (const [i, h] of header.fields.entries()) {
    const field = headerField(h);
    if (!field) continue;
    if (columns.has(field)) return { ...result, fileError: `A(z) „${FIELD_LABEL[field]}” oszlop kétszer szerepel a fejlécben` };
    columns.set(field, i);
  }
  const missing = REQUIRED.filter((f) => !columns.has(f));
  if (missing.length) {
    return {
      ...result,
      fileError:
        `Hiányzó oszlop a fejlécben: ${missing.map((f) => FIELD_LABEL[f]).join(', ')}. ` +
        `Az első sor az oszlopneveket tartalmazza: ${[...REQUIRED, 'supplier' as const].map((f) => FIELD_LABEL[f]).join(';')}`,
    };
  }

  const seen = new Map<string, number>();
  for (const { line, fields } of records) {
    const raw = fields.map((f) => f.trim());
    if (fields.length > header.fields.length && raw.slice(header.fields.length).some((f) => f !== '')) {
      result.rows.push({
        line,
        raw,
        errors: [
          `Több mező van a sorban (${fields.length}), mint oszlop a fejlécben (${header.fields.length}); ` +
            `ha egy érték tartalmazza az elválasztót („${delimiter === '\t' ? 'tabulátor' : delimiter}”), idézőjelbe kell tenni`,
        ],
      });
      continue;
    }
    const checked = validateRow((f) => (columns.has(f) ? fields[columns.get(f)!] ?? '' : ''));
    if ('errors' in checked) {
      result.rows.push({ line, raw, errors: checked.errors });
      continue;
    }
    const first = seen.get(checked.values.sku);
    if (first !== undefined) {
      result.rows.push({ line, raw, errors: [`A(z) „${checked.values.sku}” cikkszám már szerepel a(z) ${first}. sorban`] });
      continue;
    }
    seen.set(checked.values.sku, line);
    result.rows.push({ line, values: checked.values });
  }
  return result;
}

/** A keresőmező tartalma egy cikkhez. */
export const itemSearchText = (v: Pick<ImportValues, 'sku' | 'name' | 'supplier'>) => searchKey(`${v.sku} ${v.name} ${v.supplier}`);
