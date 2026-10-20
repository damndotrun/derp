import type { Visit, VisitAssignee } from '../shared/schemas.ts';
import { addDays, localDate, localRange, localTime, overlaps } from '../shared/time.ts';

/** Egy kolléga sora a napi/heti nézetben: napról napra a kiszállásai. */
export interface ColleagueRow {
  colleague: VisitAssignee;
  /** A `days` sorrendjében: az adott helyi napot érintő kiszállások kezdés szerint. */
  cells: Visit[][];
}

/** A nézet napjai (`YYYY-MM-DD`): `count` nap a `first`-től. */
export const viewDays = (first: string, count: number): string[] => Array.from({ length: count }, (_, i) => addDays(first, i));

/** A kiszállás érinti-e a helyi naptári napot (az éjfélen átnyúló mindkét napon látszik). */
export function touchesDay(v: Visit, day: string, timeZone: string): boolean {
  const { from, to } = localRange(day, 1, timeZone);
  return overlaps(v, { startsAt: from, endsAt: to });
}

/**
 * Kollégánkénti sorok: minden beosztott kolléga, akinek az időszakban kiszállása van, név szerint; ha `onlyUserId`
 * meg van adva, csak ő. Egy kiszállás minden beosztott kollégája sorában megjelenik.
 */
export function colleagueRows(visits: Visit[], days: string[], timeZone: string, onlyUserId?: string): ColleagueRow[] {
  const colleagues = new Map<string, VisitAssignee>();
  for (const v of visits) for (const a of v.assignees) if (!onlyUserId || a.id === onlyUserId) colleagues.set(a.id, a);
  return [...colleagues.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
    .map((colleague) => ({
      colleague,
      cells: days.map((day) =>
        visits.filter((v) => v.assignees.some((a) => a.id === colleague.id) && touchesDay(v, day, timeZone)),
      ),
    }));
}

/** „09:00–11:30”; ha másnap ér véget, „23:00–01:00 (másnap)”. */
export function timeRange(v: Pick<Visit, 'startsAt' | 'endsAt'>, timeZone: string, nextDayLabel: string): string {
  const range = `${localTime(v.startsAt, timeZone)}–${localTime(v.endsAt, timeZone)}`;
  return localDate(v.startsAt, timeZone) === localDate(v.endsAt, timeZone) ? range : `${range} (${nextDayLabel})`;
}

const weekdayFormat = new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', weekday: 'short' });
const longFormat = new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

/** Naptári nap rövid felirata, pl. „H 10. 19.” (a dátum időzóna nélküli, ezért UTC-ben formázva). */
export const dayLabel = (day: string): string =>
  `${weekdayFormat.format(new Date(`${day}T12:00:00Z`))} ${day.slice(5, 7)}. ${day.slice(8, 10)}.`;

/** Naptári nap hosszú felirata, pl. „2026. október 20., kedd”. */
export const longDayLabel = (day: string): string => longFormat.format(new Date(`${day}T12:00:00Z`));
