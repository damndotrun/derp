// Szám- és pénzbevitel a szerkesztőben, magyar formában („2 150,50”, „2,5”). Szerveren és kliensen ugyanaz.
export { formatFiller } from '../../catalog/shared/format.ts';

/**
 * Magyar formájú nem negatív szám: „2 150,50”, „2150,5”, „1.234,50”, „12 Ft”; vessző nélkül a pont tizedespont
 * („2150.50”), kivéve ha ezres csoportokat választ el („1.234” = 1234). Legfeljebb `maxDecimals` tizedesjegy; más
 * alakra `null`.
 */
export function parseDecimal(input: string, maxDecimals: number): number | null {
  let s = input.replace(/[\s  ]/g, '').replace(/(Ft|HUF|%)$/i, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2]?.length ?? 0) > maxDecimals) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Forintban beírt összeg fillérben („2 150,50” → 215050); legfeljebb 2 tizedesjegy. */
export function parseFtToFiller(input: string): number | null {
  const n = parseDecimal(input, 2);
  if (n === null) return null;
  const filler = Math.round(n * 100);
  return Number.isSafeInteger(filler) ? filler : null;
}

/** Szám a beviteli mezőbe, csoportosítás nélkül, tizedesvesszővel („2,5”). */
export function decimalInput(n: number, maxDecimals: number): string {
  return String(Number(n.toFixed(maxDecimals))).replace('.', ',');
}

/** Fillér a beviteli mezőbe forintban („215050” → „2150,50”, „4850000” → „48500”). */
export function fillerInput(filler: number): string {
  return filler % 100 === 0 ? String(filler / 100) : (filler / 100).toFixed(2).replace('.', ',');
}

/** Mennyiség megjelenítése („2,5”, „1 200”). */
export function formatQuantity(n: number): string {
  return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 3 }).format(n);
}

/** Az ajánlat azonosítója a felületen és a PDF-en: sorszám/verzió („12/2”). */
export const quoteRef = (number: number, versionNo: number) => `${number}/${versionNo}`;
