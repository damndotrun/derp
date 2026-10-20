import type { TimelineEvent } from '@derp/shared';

// Az idővonal csoportosítása (tiszta függvények, a megjelenítéstől függetlenül tesztelhetők). A tárolás UTC; a napot
// és a hetet a megjelenítési időzóna (`TZ_DISPLAY`) szerinti naptári dátumból számoljuk, így a nyári időszámítás
// váltása (23 vagy 25 órás nap) nem csúsztatja el a határokat. A hét hétfőn kezdődik.

export type Period = 'day' | 'week';

/** Egy esemény a hozzá tartozó (szülő-azonosítóval hivatkozó) eseményekkel, pl. felmérés és a fotói. */
export interface EventNode {
  kind: 'event';
  event: TimelineEvent;
  children: TimelineEvent[];
}

/** Ugyanannak a típusnak legalább két eseménye egy időszakon belül. */
export interface TypeNode {
  kind: 'type';
  /** Egyedi kulcs az összecsukási állapothoz: `<időszak kulcsa>|<típus>`. */
  key: string;
  type: string;
  items: EventNode[];
}

export type TimelineNode = EventNode | TypeNode;

export interface PeriodGroup {
  /** A nap vagy a hét első napja (hétfő), `YYYY-MM-DD`, a megjelenítési időzónában. */
  key: string;
  nodes: TimelineNode[];
  /** Az időszak összes eseménye, a kapcsolódókkal együtt. */
  count: number;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** A pillanat naptári dátuma (`YYYY-MM-DD`) a megadott időzónában. */
export function localDate(iso: string | Date, timeZone: string): string {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(typeof iso === 'string' ? new Date(iso) : iso).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const toUtcDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
const fromUtcDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Naptári dátum eltolása napokkal (időzónától független, mert csak a dátummal számol). */
export function addDays(date: string, days: number): string {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** A dátum hetének hétfője. */
export function weekStart(date: string): string {
  const dow = toUtcDate(date).getUTCDay(); // 0 = vasárnap
  return addDays(date, -((dow + 6) % 7));
}

/** ISO 8601 hét sorszáma (a hét csütörtökének éve szerint, pl. 2027. január 1. a 2026. év 53. hetén van). */
export function isoWeek(date: string): number {
  const thursday = toUtcDate(addDays(weekStart(date), 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / 86_400_000 / 7) + 1;
}

/** Az esemény időszakának kulcsa: a helyi nap, illetve a helyi hét hétfője. */
export function periodKey(iso: string, timeZone: string, period: Period): string {
  const day = localDate(iso, timeZone);
  return period === 'day' ? day : weekStart(day);
}

/**
 * Az időrendben fordított (legújabb elöl) eseménylistát időszakokra bontja. A szülő-azonosítóval hivatkozó esemény
 * a szülője alá kerül, ha a szülő is be van töltve (különben önállóan látszik). `byType` mellett egy időszakon belül
 * az azonos típusú események (legalább kettő) egy csoportba kerülnek, a csoport a legújabb eleme helyén áll.
 */
export function groupTimeline(
  events: TimelineEvent[],
  { timeZone, period, byType }: { timeZone: string; period: Period; byType: boolean },
): PeriodGroup[] {
  const ids = new Set(events.map((e) => e.id));
  const children = new Map<string, TimelineEvent[]>();
  const top: TimelineEvent[] = [];
  for (const e of events) {
    if (e.parentId && e.parentId !== e.id && ids.has(e.parentId)) {
      const list = children.get(e.parentId) ?? [];
      list.push(e);
      children.set(e.parentId, list);
    } else {
      top.push(e);
    }
  }

  const groups = new Map<string, { key: string; events: EventNode[]; count: number }>();
  for (const e of top) {
    const key = periodKey(e.occurredAt, timeZone, period);
    let g = groups.get(key);
    if (!g) {
      g = { key, events: [], count: 0 };
      groups.set(key, g);
    }
    const node: EventNode = { kind: 'event', event: e, children: children.get(e.id) ?? [] };
    g.events.push(node);
    g.count += 1 + node.children.length;
  }

  return [...groups.values()].map(({ key, events: nodes, count }) => ({
    key,
    count,
    nodes: byType ? groupByType(key, nodes) : nodes,
  }));
}

function groupByType(periodKey: string, nodes: EventNode[]): TimelineNode[] {
  const byType = new Map<string, EventNode[]>();
  for (const n of nodes) {
    const list = byType.get(n.event.type) ?? [];
    list.push(n);
    byType.set(n.event.type, list);
  }
  // A Map a beszúrási sorrendet tartja: minden típus a legújabb eseménye helyén jelenik meg.
  return [...byType.entries()].map(([type, items]) =>
    items.length === 1 ? items[0]! : { kind: 'type', key: `${periodKey}|${type}`, type, items },
  );
}

/** Egy időszak és az alatta lévő összes esemény száma (kibontott állapotban látható elemek). */
export function nodeEventCount(node: TimelineNode): number {
  return node.kind === 'event' ? 1 + node.children.length : node.items.reduce((n, i) => n + 1 + i.children.length, 0);
}

const dayFormat = new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const rangeFormat = new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

export interface PeriodLabels {
  today: string;
  yesterday: string;
  thisWeek: string;
  lastWeek: string;
  /** `{n}` helyére a hét sorszáma kerül. */
  week: string;
}

/**
 * Az időszak felirata, pl. „Ma · 2026. október 20., kedd” vagy „43. hét · 2026. október 19–25.”. A `today` a mai
 * nap a megjelenítési időzónában (`localDate(new Date(), tz)`).
 */
export function periodLabel(key: string, period: Period, today: string, labels: PeriodLabels): string {
  if (period === 'day') {
    const text = dayFormat.format(toUtcDate(key));
    const rel = key === today ? labels.today : key === addDays(today, -1) ? labels.yesterday : null;
    return rel ? `${rel} · ${text}` : text;
  }
  // Az ICU a tartományjel körül keskeny szóközt tesz; sima szóközzel egységes (és kereshető) a felirat.
  const range = rangeFormat.formatRange(toUtcDate(key), toUtcDate(addDays(key, 6))).replace(/[\u2009\u202f\u00a0]/g, ' ');
  const current = weekStart(today);
  const rel = key === current ? labels.thisWeek : key === addDays(current, -7) ? labels.lastWeek : null;
  const week = labels.week.replace('{n}', String(isoWeek(key)));
  return `${rel ? `${rel} · ` : ''}${week} · ${range}`;
}
