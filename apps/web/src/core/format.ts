/** Időpont megjelenítése a TZ_DISPLAY időzónában (a tárolás UTC). */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('hu-HU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
