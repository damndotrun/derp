import { z } from 'zod';

// A `catalog` modul API-sémái (szerveren validálásra, a kliens és a 10. munkacsomag a típusokat használja).

/** A magyar ÁFA-kulcsok százalékban. A különleges jelölések (AAM, TAM, fordított adózás) nincsenek benne (ld. README). */
export const VAT_RATES = [0, 5, 18, 27] as const;
export const VatRate = z.literal(VAT_RATES);
export type VatRate = z.infer<typeof VatRate>;

export const CatalogItem = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  /** Nettó egységár fillérben (1/100 Ft), egész szám: 12,50 Ft = 1250. */
  netUnitPriceFiller: z.number().int().nonnegative(),
  vatRate: VatRate,
  supplier: z.string(),
  version: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

export const CATALOG_PAGE_SIZE = 50;

export const CatalogListQuery = z.object({
  /** Szavanként, kis-nagybetűtől és ékezettől függetlenül a cikkszámban, a megnevezésben és a beszállítóban. */
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(CATALOG_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CatalogList = z.object({ items: z.array(CatalogItem), total: z.number().int() });
export type CatalogList = z.infer<typeof CatalogList>;

/** A CSV-fájl legnagyobb mérete (bájt). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export const ImportRequest = z.object({
  fileName: z.string().max(255).default(''),
  /** A fájl tartalma base64-ben (a kódolást – UTF-8, UTF-16, Windows-1250 – a szerver ismeri fel). */
  content: z.base64().max(Math.ceil(IMPORT_MAX_BYTES / 3) * 4, 'A fájl legfeljebb 10 MB lehet'),
});
export type ImportRequest = z.input<typeof ImportRequest>;

export const ImportField = z.enum(['sku', 'name', 'unit', 'netUnitPriceFiller', 'vatRate', 'supplier']);
export type ImportField = z.infer<typeof ImportField>;

export const ImportValues = z.object({
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  netUnitPriceFiller: z.number().int(),
  vatRate: VatRate,
  supplier: z.string(),
});
export type ImportValues = z.infer<typeof ImportValues>;

/** Egy CSV-sor az előnézetben: új cikk, módosuló (melyik mező), változatlan, vagy hibás (miért; ez nem importálódik). */
export const ImportRow = z.discriminatedUnion('status', [
  z.object({ line: z.number().int(), status: z.literal('new'), values: ImportValues }),
  z.object({ line: z.number().int(), status: z.literal('changed'), values: ImportValues, changed: z.array(ImportField) }),
  z.object({ line: z.number().int(), status: z.literal('unchanged'), values: ImportValues }),
  z.object({ line: z.number().int(), status: z.literal('error'), raw: z.array(z.string()), errors: z.array(z.string()) }),
]);
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportSummary = z.object({
  new: z.number().int(),
  changed: z.number().int(),
  unchanged: z.number().int(),
  error: z.number().int(),
});
export type ImportSummary = z.infer<typeof ImportSummary>;

export const ImportPreview = z.object({
  /** Ha a fájl egésze nem olvasható (pl. hiányzó kötelező oszlop), itt az ok, és nincs sor. */
  fileError: z.string().nullable(),
  encoding: z.string(),
  delimiter: z.string(),
  summary: ImportSummary,
  /** A hibás sorok (legfeljebb `PREVIEW_ERROR_ROWS`), utánuk a többi sor (legfeljebb `PREVIEW_OK_ROWS`), sorszám szerint. */
  rows: z.array(ImportRow),
  /** Ennyi sor nem fért a válaszba (a `summary` mindet számolja). */
  omitted: z.number().int(),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

export const PREVIEW_ERROR_ROWS = 200;
export const PREVIEW_OK_ROWS = 100;

export const ImportResult = z.object({ summary: ImportSummary });
export type ImportResult = z.infer<typeof ImportResult>;
