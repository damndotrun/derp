import { z } from 'zod';
import { VatRate } from '../../catalog/shared/schemas.ts';
import { DISCOUNT_SCALE, lineNetFiller, QUANTITY_SCALE, scaled } from './money.ts';

// A `quotes` modul API-sémái (szerveren validálásra, a kliens a típusokat használja). Pénz mindenhol fillérben.

/** Kézi státusz (spec): tervezet / kiküldve / elfogadva / elutasítva. Csak a tervezet szerkeszthető. */
export const QUOTE_STATUSES = ['tervezet', 'kikuldve', 'elfogadva', 'elutasitva'] as const;
export const QuoteStatus = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof QuoteStatus>;

export const MAX_ITEMS = 200;
export const MAX_NOTE = 4000;
export const MAX_QUANTITY = 1_000_000;
/** Egy tétel nettó egységárának felső határa: 1 milliárd Ft. */
export const MAX_UNIT_PRICE_FILLER = 100_000_000_000;
/** Egy tétel nettó értékének felső határa: 10 milliárd Ft (így a végösszeg is biztonságos egész marad). */
export const MAX_LINE_NET_FILLER = 1_000_000_000_000;

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1, 'kötelező mező');

/**
 * Egy ajánlattétel. A cikktörzsből felvett tétel a cikk adatait (cikkszám, megnevezés, egység, nettó egységár,
 * ÁFA-kulcs) másolja, így a cikktörzs későbbi importja nem írja át az ajánlatot; a `catalogItemId` csak hivatkozás.
 * Kézi tételnél a `catalogItemId` `null`, a cikkszám üres.
 */
export const QuoteItem = z
  .object({
    /** A kliens által kiosztott azonosító (a sorrend és a szerkesztés követésére). */
    id: z.uuid(),
    catalogItemId: z.uuid().nullable(),
    sku: text(64),
    name: required(500),
    unit: required(20),
    quantity: z
      .number()
      .positive('a mennyiség legyen pozitív')
      .max(MAX_QUANTITY)
      .refine((n) => scaled(n, QUANTITY_SCALE) !== null, 'a mennyiség legfeljebb 3 tizedesjegy'),
    netUnitPriceFiller: z.number().int().nonnegative().max(MAX_UNIT_PRICE_FILLER),
    vatRate: VatRate,
    /** Tételenkénti kedvezmény százalékban, 0–100, legfeljebb 2 tizedesjegy. */
    discountPercent: z
      .number()
      .min(0)
      .max(100)
      .refine((n) => scaled(n, DISCOUNT_SCALE) !== null, 'a kedvezmény legfeljebb 2 tizedesjegy'),
  })
  .refine((i) => lineNetFiller(i) <= MAX_LINE_NET_FILLER, 'A tétel értéke túl nagy');
export type QuoteItem = z.infer<typeof QuoteItem>;

const items = z
  .array(QuoteItem)
  .max(MAX_ITEMS)
  .refine((list) => new Set(list.map((i) => i.id)).size === list.length, 'Egy tétel kétszer szerepel');

const LocalDate = z.iso.date();

/** `PUT /api/quotes/versions/:versionId`: a tervezet teljes tartalma (tételek, megjegyzés, érvényesség). */
export const VersionUpdate = z.object({
  /** A szerkesztett állapot száma; eltérésnél 409 (közben más mentett). */
  revision: z.number().int(),
  items,
  note: text(MAX_NOTE).default(''),
  /** Az ajánlat érvényessége (eddig a napig), üresen `null`. */
  validUntil: LocalDate.nullable().default(null),
});
export type VersionUpdate = z.input<typeof VersionUpdate>;

/** `POST /api/quotes/versions/:versionId/status`. */
export const StatusChange = z.object({ revision: z.number().int(), status: QuoteStatus });
export type StatusChange = z.infer<typeof StatusChange>;

/** `POST /api/quotes/versions/:versionId/pdf`: a PDF a megadott szerkesztett állapotról készül. */
export const PdfRequest = z.object({ revision: z.number().int() });
export type PdfRequest = z.infer<typeof PdfRequest>;

export const Person = z.object({ id: z.uuid(), name: z.string() });
export type Person = z.infer<typeof Person>;

const isoDateTime = z.iso.datetime({ offset: true });

export const VatBreakdown = z.object({
  vatRate: z.number().int(),
  netFiller: z.number().int(),
  vatFiller: z.number().int(),
  grossFiller: z.number().int(),
});

export const QuoteTotals = z.object({
  lineNetFiller: z.array(z.number().int()),
  byVatRate: z.array(VatBreakdown),
  netFiller: z.number().int(),
  vatFiller: z.number().int(),
  grossFiller: z.number().int(),
  totalFiller: z.number().int(),
  roundingFiller: z.number().int(),
});

/** Egy elkészült PDF (a verzióval együtt megmarad). */
export const QuotePdf = z.object({
  id: z.uuid(),
  fileName: z.string(),
  size: z.number().int(),
  /** A verzió szerkesztett állapota, amelyről készült. */
  revision: z.number().int(),
  totalFiller: z.number().int(),
  createdAt: isoDateTime,
  createdBy: Person,
});
export type QuotePdf = z.infer<typeof QuotePdf>;

export const QuoteVersion = z.object({
  id: z.uuid(),
  quoteId: z.uuid(),
  versionNo: z.number().int(),
  status: QuoteStatus,
  revision: z.number().int(),
  items: z.array(QuoteItem),
  note: z.string(),
  validUntil: LocalDate.nullable(),
  totals: QuoteTotals,
  /** A legutóbbi PDF-fel kezdve. */
  pdfs: z.array(QuotePdf),
  createdAt: isoDateTime,
  createdBy: Person,
  updatedAt: isoDateTime,
});
export type QuoteVersion = z.infer<typeof QuoteVersion>;

export const Quote = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string(),
  clientName: z.string().nullable(),
  /** Az ajánlat sorszáma (rendszerszinten egyedi, folyamatos). */
  number: z.number().int(),
  createdAt: isoDateTime,
  createdBy: Person,
  /** A verziók, az elsővel kezdve; az utolsó a legújabb. */
  versions: z.array(QuoteVersion),
});
export type Quote = z.infer<typeof Quote>;

/** Egy ajánlat a listában a legújabb verziójával. */
export const QuoteSummary = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string(),
  clientName: z.string().nullable(),
  number: z.number().int(),
  versionNo: z.number().int(),
  status: QuoteStatus,
  totalFiller: z.number().int(),
  itemCount: z.number().int(),
  updatedAt: isoDateTime,
});
export type QuoteSummary = z.infer<typeof QuoteSummary>;

export const QuoteList = z.object({ items: z.array(QuoteSummary) });
export type QuoteList = z.infer<typeof QuoteList>;

/** A PDF fejléce (a cég adatai): a `quotes` modul saját admin beállítása, mert a magban nincs beállítás-tár. */
export const SettingsUpdate = z.object({
  version: z.number().int(),
  companyName: text(200),
  address: text(500),
  taxNumber: text(50),
  phone: text(100),
  email: text(200),
  bankAccount: text(100),
  /** A PDF alján (pl. fizetési feltételek). */
  footer: text(1000),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

export const Settings = SettingsUpdate.extend({
  /** Van-e feltöltött logó (`GET /api/quotes/settings/logo`). */
  hasLogo: z.boolean(),
  updatedAt: isoDateTime,
});
export type Settings = z.infer<typeof Settings>;

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg'] as const;

/** `PUT /api/quotes/settings/logo`: PNG vagy JPEG, base64-ben, legfeljebb 1 MB. */
export const LogoUpload = z.object({
  mime: z.enum(LOGO_TYPES),
  content: z.base64().max(Math.ceil(LOGO_MAX_BYTES / 3) * 4, 'A logó legfeljebb 1 MB lehet'),
});
export type LogoUpload = z.infer<typeof LogoUpload>;

export const QUOTES_EVENTS = {
  created: 'quotes.created',
  versionCreated: 'quotes.version_created',
  statusChanged: 'quotes.status_changed',
  pdfCreated: 'quotes.pdf_created',
} as const;

/** A `quotes.created` és `quotes.version_created` esemény `data` mezője. */
export interface QuoteEventData {
  quoteId: string;
  versionId: string;
  number: number;
  versionNo: number;
  status: QuoteStatus;
}

/** A `quotes.status_changed` esemény `data` mezője. */
export interface StatusEventData extends QuoteEventData {
  from: QuoteStatus;
}

/** A `quotes.pdf_created` esemény `data` mezője. */
export interface PdfEventData extends QuoteEventData {
  pdfId: string;
  fileName: string;
}
