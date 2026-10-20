// Az árajánlat PDF-je `pdfmake`-kel, szerver oldalon, beépített sablonnal: a cég fejléce (a modul beállításaiból, a
// logóval), az ügyfél, a tételek, az ÁFA-kulcsonkénti összesítés és a forintra kerekített végösszeg.
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Content, TableCell } from 'pdfmake';
import { formatFiller, formatQuantity, quoteRef } from '../shared/format.ts';
import { quoteTotals } from '../shared/money.ts';
import type { QuoteItem } from '../shared/schemas.ts';

export interface PdfCompany {
  companyName: string;
  address: string;
  taxNumber: string;
  phone: string;
  email: string;
  bankAccount: string;
  footer: string;
  logo: { mime: string; data: Buffer } | null;
}

export interface PdfQuote {
  number: number;
  versionNo: number;
  projectName: string;
  client: { name: string; address: string } | null;
  items: QuoteItem[];
  note: string;
  validUntil: string | null;
  /** A PDF kelte (a megjelenítési időzónában). */
  issuedAt: Date;
  timeZone: string;
}

type PdfMake = typeof import('pdfmake');
type TDocumentDefinitions = Parameters<PdfMake['createPdf']>[0];
let loaded: Promise<PdfMake> | null = null;

/** A `pdfmake` csak az első PDF-nél töltődik be (memória); külső URL-t és a betűkészleten kívüli fájlt nem olvas. */
function pdfmake(): Promise<PdfMake> {
  loaded ??= (async () => {
    const mod = ((await import('pdfmake')) as unknown as { default: PdfMake }).default;
    const dir = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
    const font = (f: string) => path.join(dir, f);
    const fonts = {
      normal: font('Roboto-Regular.ttf'),
      bold: font('Roboto-Medium.ttf'),
      italics: font('Roboto-Italic.ttf'),
      bolditalics: font('Roboto-MediumItalic.ttf'),
    };
    const allowed = new Set(Object.values(fonts));
    mod.setFonts({ Roboto: fonts });
    mod.setUrlAccessPolicy(() => false);
    mod.setLocalAccessPolicy((p) => allowed.has(path.resolve(p)));
    return mod;
  })();
  return loaded;
}

const formatDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('hu-HU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** `YYYY-MM-DD` → „2026. 11. 19.” (naptári nap, időzóna nélkül). */
const formatLocalDate = (s: string) => formatDate(new Date(`${s}T12:00:00Z`), 'UTC');
const percent = (n: number) => `${new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 2 }).format(n)}%`;

const GREY = '#555555';
const LINE = '#cccccc';

/** A PDF fájlneve: `arajanlat-12-2.pdf`. */
export const pdfFileName = (number: number, versionNo: number) => `arajanlat-${number}-${versionNo}.pdf`;

export function documentDefinition(company: PdfCompany, quote: PdfQuote): TDocumentDefinitions {
  const totals = quoteTotals(quote.items);
  const companyLines = [
    company.address,
    company.taxNumber && `Adószám: ${company.taxNumber}`,
    company.phone && `Telefon: ${company.phone}`,
    company.email && `E-mail: ${company.email}`,
    company.bankAccount && `Bankszámla: ${company.bankAccount}`,
  ].filter(Boolean);

  const header: Content = {
    columns: [
      company.logo
        ? { image: `data:${company.logo.mime};base64,${company.logo.data.toString('base64')}`, fit: [160, 64], width: 170 }
        : { text: '', width: 0 },
      {
        width: '*',
        alignment: 'right',
        stack: [
          ...(company.companyName ? [{ text: company.companyName, bold: true, fontSize: 13 }] : []),
          ...companyLines.map((l) => ({ text: l, fontSize: 8.5, color: GREY })),
        ],
      },
    ],
    margin: [0, 0, 0, 16],
  };

  const meta: Content = {
    columns: [
      {
        width: '*',
        stack: [
          { text: 'Ajánlatkérő', fontSize: 8.5, color: GREY },
          { text: quote.client?.name || '–', bold: true },
          ...(quote.client?.address ? [{ text: quote.client.address }] : []),
          { text: `Projekt: ${quote.projectName}`, margin: [0, 4, 0, 0] },
        ],
      },
      {
        width: 'auto',
        table: {
          body: [
            ['Ajánlat száma:', { text: quoteRef(quote.number, quote.versionNo), bold: true }],
            ['Kelte:', formatDate(quote.issuedAt, quote.timeZone)],
            ...(quote.validUntil ? [['Érvényes:', `${formatLocalDate(quote.validUntil)}-ig`]] : []),
          ],
        },
        layout: 'noBorders',
      },
    ],
    margin: [0, 0, 0, 14],
  };

  const right = (text: string, extra: Record<string, unknown> = {}): TableCell => ({ text, alignment: 'right', noWrap: true, ...extra });
  const head = (text: string, alignment: 'left' | 'right' = 'left'): TableCell => ({ text, bold: true, fontSize: 8.5, alignment });
  const itemsTable: Content = {
    table: {
      headerRows: 1,
      widths: [16, '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [head('#'), head('Megnevezés'), head('Menny.', 'right'), head('Egys.'), head('Nettó egységár', 'right'), head('Kedv.', 'right'), head('ÁFA', 'right'), head('Nettó érték', 'right')],
        ...quote.items.map((item, i): TableCell[] => [
          { text: String(i + 1), color: GREY },
          { stack: [{ text: item.name }, ...(item.sku ? [{ text: item.sku, fontSize: 7.5, color: GREY }] : [])] },
          right(formatQuantity(item.quantity)),
          item.unit,
          right(formatFiller(item.netUnitPriceFiller)),
          right(item.discountPercent ? percent(item.discountPercent) : '–'),
          right(percent(item.vatRate)),
          right(formatFiller(totals.lineNetFiller[i]!)),
        ]),
      ],
    },
    layout: {
      hLineWidth: (i: number) => (i <= 1 ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    fontSize: 9,
    margin: [0, 0, 0, 12],
  };

  const vatTable: Content = {
    table: {
      headerRows: 1,
      widths: ['auto', 'auto', 'auto', 'auto'],
      body: [
        [head('ÁFA-kulcs'), head('Nettó', 'right'), head('ÁFA', 'right'), head('Bruttó', 'right')],
        ...totals.byVatRate.map((r): TableCell[] => [
          percent(r.vatRate),
          right(formatFiller(r.netFiller)),
          right(formatFiller(r.vatFiller)),
          right(formatFiller(r.grossFiller)),
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    fontSize: 9,
  };

  const sumRows: TableCell[][] = [
    ['Nettó összesen:', right(formatFiller(totals.netFiller))],
    ['ÁFA összesen:', right(formatFiller(totals.vatFiller))],
    ['Bruttó összesen:', right(formatFiller(totals.grossFiller))],
    ...(totals.roundingFiller ? [['Kerekítés:', right(formatFiller(totals.roundingFiller))]] : []),
    [
      { text: 'Végösszeg:', bold: true, fontSize: 12 },
      right(formatFiller(totals.totalFiller), { bold: true, fontSize: 12 }),
    ],
  ];
  const summary: Content = {
    columns: [
      { width: '*', stack: [{ text: 'ÁFA-kulcsonként', fontSize: 8.5, color: GREY, margin: [0, 0, 0, 2] }, vatTable] },
      { width: 'auto', table: { body: sumRows }, layout: 'noBorders' },
    ],
    columnGap: 16,
    margin: [0, 0, 0, 14],
  };

  return {
    info: { title: `Árajánlat ${quoteRef(quote.number, quote.versionNo)}`, author: company.companyName || undefined },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.15 },
    footer: (page: number, pages: number) => ({
      margin: [40, 10, 40, 0],
      columns: [
        { text: company.footer, fontSize: 7.5, color: GREY, width: '*' },
        { text: `${page}/${pages}. oldal`, fontSize: 7.5, color: GREY, alignment: 'right', width: 'auto' },
      ],
    }),
    content: [
      header,
      { text: 'ÁRAJÁNLAT', fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
      meta,
      itemsTable,
      summary,
      ...(quote.note ? [{ text: 'Megjegyzés', bold: true, margin: [0, 0, 0, 2] } as Content, { text: quote.note }] : []),
    ],
  };
}

/** A PDF bájtjai. */
export async function renderQuotePdf(company: PdfCompany, quote: PdfQuote): Promise<Buffer> {
  const mod = await pdfmake();
  return mod.createPdf(documentDefinition(company, quote)).getBuffer();
}
