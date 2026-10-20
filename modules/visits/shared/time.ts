// Naptári segédek a TZ_DISPLAY időzónához (szerveren és kliensen is). A tárolás UTC; a „mai nap”, a napi és heti
// nézet határai és az űrlapon megadott időpontok a megjelenítési időzónában értendők; a hét hétfőn kezdődik.

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(at: Date, timeZone: string): Record<string, number> {
  let f = partFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(timeZone, f);
  }
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return parts;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A pillanat naptári dátuma (`YYYY-MM-DD`) az időzónában. */
export function localDate(at: Date | string, timeZone: string): string {
  const p = wallClock(new Date(at), timeZone);
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}`;
}

/** A pillanat órája és perce (`HH:MM`) az időzónában. */
export function localTime(at: Date | string, timeZone: string): string {
  const p = wallClock(new Date(at), timeZone);
  return `${pad(p.hour!)}:${pad(p.minute!)}`;
}

/** Az időzóna eltérése az UTC-től ezredmásodpercben az adott pillanatban. */
function offsetMs(at: Date, timeZone: string): number {
  const p = wallClock(at, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Faliórás időpont (dátum + `HH:MM`) az időzónában → UTC pillanat. Nyári időszámítás váltásakor a nem létező
 * időpont (pl. 02:30 márciusban) előre tolódik, a kétszer előforduló (október) az első, nyári idős pillanat lesz.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  // A váltás előtti és utáni eltéréssel számolt jelöltek közül az, amelyik valóban erre a faliórás időre esik.
  const before = wall - offsetMs(new Date(wall - 12 * 3_600_000), timeZone);
  const after = wall - offsetMs(new Date(wall + 12 * 3_600_000), timeZone);
  const matches = (t: number) => {
    const p = wallClock(new Date(t), timeZone);
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) === wall;
  };
  const valid = [before, after].filter(matches);
  // Kétszer előforduló időpont: a korábbi; nem létező (átugrott) időpont: a váltás előtti eltéréssel, azaz előre tolva.
  return new Date(valid.length > 0 ? Math.min(...valid) : before);
}

/** Naptári dátum eltolása napokkal. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A dátum hetének hétfője. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = vasárnap
  return addDays(date, -((dow + 6) % 7));
}

/** A helyi naptári napok `[from, to)` UTC-határai: `days` nap a `date` napjától kezdve. */
export function localRange(date: string, days: number, timeZone: string): { from: Date; to: Date } {
  return { from: zonedToUtc(date, '00:00', timeZone), to: zonedToUtc(addDays(date, days), '00:00', timeZone) };
}

/** Két `[start, end)` időszak fedi-e egymást (az egymásba érő vég és kezdet nem ütközés). */
export function overlaps(a: { startsAt: Date | string; endsAt: Date | string }, b: { startsAt: Date | string; endsAt: Date | string }): boolean {
  const t = (v: Date | string) => new Date(v).getTime();
  return t(a.startsAt) < t(b.endsAt) && t(b.startsAt) < t(a.endsAt);
}
