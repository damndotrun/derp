// Megjelenítés és keresés: szerveren és kliensen ugyanaz.

/** Kisbetűs, ékezet nélküli alak a kereséshez („Hővisszanyerő” → „hovisszanyero”). */
export function searchKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Fillérben megadott összeg forintban, magyar formában: „48 500 Ft”, „12,50 Ft”. */
export function formatFiller(filler: number): string {
  const whole = filler % 100 === 0;
  return new Intl.NumberFormat('hu-HU', {
    style: 'currency',
    currency: 'HUF',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(filler / 100);
}
