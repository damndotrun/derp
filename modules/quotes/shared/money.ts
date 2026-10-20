// Az ajánlat összegzése: szerveren (mentés, PDF) és kliensen (élő összesítő) ugyanaz a számítás.
//
// Minden összeg fillérben (1/100 Ft), egész számként (jóváhagyott döntés, ld. catalog/README.md). A mennyiség ezredben,
// a kedvezmény századszázalékban egész, így a számítás egésszel (BigInt) megy, lebegőpontos hiba nélkül. Kerekítés
// mindenhol fél felfelé (kereskedelmi kerekítés):
// - tétel nettó = mennyiség × nettó egységár × (1 − kedvezmény%), fillérre kerekítve;
// - ÁFA-kulcsonként: a nettók összege, az ÁFA = nettó × kulcs, fillérre kerekítve (nem tételenként), bruttó = nettó + ÁFA;
// - a végösszeg a bruttók összege forintra kerekítve (spec: „a bruttó kerekítése forintra a végösszegnél”).

/** A mennyiség ennyiedre pontos (3 tizedesjegy). */
export const QUANTITY_SCALE = 1000;
/** A kedvezmény százalékban, ennyiedre pontos (2 tizedesjegy). */
export const DISCOUNT_SCALE = 100;

export interface MoneyLine {
  quantity: number;
  netUnitPriceFiller: number;
  vatRate: number;
  /** Tételenkénti kedvezmény százalékban (0–100). */
  discountPercent: number;
}

export interface VatBreakdown {
  vatRate: number;
  netFiller: number;
  vatFiller: number;
  grossFiller: number;
}

export interface QuoteTotals {
  /** Tételenként a nettó (fillér), a tételek sorrendjében. */
  lineNetFiller: number[];
  /** ÁFA-kulcsonként, csökkenő kulcs szerint. */
  byVatRate: VatBreakdown[];
  netFiller: number;
  vatFiller: number;
  grossFiller: number;
  /** A végösszeg: a bruttó forintra kerekítve (fillérben, tehát 100 többszöröse). */
  totalFiller: number;
  /** `totalFiller − grossFiller` (−50 … +50 fillér). */
  roundingFiller: number;
}

/** Egész arány fél felfelé kerekítve (nem negatív számlálóra és pozitív nevezőre). */
function roundDiv(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/** A tizedes szám egész többszöröse (`scaled(2.5, 1000)` = 2500); ha nem pontos, `null`. */
export function scaled(value: number, scale: number): number | null {
  const n = Math.round(value * scale);
  return Math.abs(n - value * scale) < 1e-6 && Number.isSafeInteger(n) ? n : null;
}

/** Egy tétel nettó értéke fillérben. */
export function lineNetFiller(line: MoneyLine): number {
  const qty = BigInt(scaled(line.quantity, QUANTITY_SCALE) ?? Math.round(line.quantity * QUANTITY_SCALE));
  const discount = BigInt(scaled(line.discountPercent, DISCOUNT_SCALE) ?? Math.round(line.discountPercent * DISCOUNT_SCALE));
  const full = BigInt(100 * DISCOUNT_SCALE);
  const n = qty * BigInt(line.netUnitPriceFiller) * (full - discount);
  return Number(roundDiv(n, BigInt(QUANTITY_SCALE) * full));
}

/** Az ajánlat összesítése: tételenként nettó, ÁFA-kulcsonként nettó/ÁFA/bruttó, forintra kerekített végösszeg. */
export function quoteTotals(lines: MoneyLine[]): QuoteTotals {
  const lineNet = lines.map(lineNetFiller);
  const byRate = new Map<number, bigint>();
  lines.forEach((l, i) => byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0n) + BigInt(lineNet[i]!)));

  const byVatRate = [...byRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([vatRate, net]): VatBreakdown => {
      const vat = roundDiv(net * BigInt(vatRate), 100n);
      return { vatRate, netFiller: Number(net), vatFiller: Number(vat), grossFiller: Number(net + vat) };
    });
  const sum = (k: 'netFiller' | 'vatFiller' | 'grossFiller') => byVatRate.reduce((s, r) => s + r[k], 0);
  const grossFiller = sum('grossFiller');
  const totalFiller = Number(roundDiv(BigInt(grossFiller), 100n)) * 100;
  return {
    lineNetFiller: lineNet,
    byVatRate,
    netFiller: sum('netFiller'),
    vatFiller: sum('vatFiller'),
    grossFiller,
    totalFiller,
    roundingFiller: totalFiller - grossFiller,
  };
}
