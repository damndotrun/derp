import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@derp/shared';
import { addDays, groupTimeline, isoWeek, localDate, periodKey, periodLabel, weekStart, type PeriodLabels } from './timeline.ts';

const TZ = 'Europe/Budapest';
const LABELS: PeriodLabels = { today: 'Ma', yesterday: 'Tegnap', thisWeek: 'Ez a hét', lastWeek: 'Múlt hét', week: '{n}. hét' };

let n = 0;
const ev = (occurredAt: string, over: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  projectId: null,
  type: 'core.project_updated',
  source: 'user',
  occurredAt,
  actor: null,
  title: `E${n}`,
  data: {},
  parentId: null,
  ...over,
});

/** Csoportkulcsok és csoportonként az események címei. */
const shape = (events: TimelineEvent[], period: 'day' | 'week', timeZone = TZ) =>
  groupTimeline(events, { timeZone, period, byType: false }).map((g) => [
    g.key,
    g.nodes.map((node) => (node.kind === 'event' ? node.event.title : node.type)),
  ]);

describe('időzóna-határ', () => {
  it('a napot a megjelenítési időzóna szerint vágja, nem UTC szerint', () => {
    // 22:30 UTC = másnap 00:30 Budapesten (téli időben 23:30 → még aznap).
    expect(localDate('2026-10-20T21:59:59Z', TZ)).toBe('2026-10-20');
    expect(localDate('2026-10-20T22:00:00Z', TZ)).toBe('2026-10-21');
    expect(localDate('2026-12-01T22:59:59Z', TZ)).toBe('2026-12-01');
    expect(localDate('2026-12-01T23:00:00Z', TZ)).toBe('2026-12-02');
  });

  it('az éjfél körüli események a helyi nap szerint kerülnek csoportba', () => {
    const late = ev('2026-10-20T21:30:00Z', { title: 'kedd 23:30' });
    const early = ev('2026-10-20T22:30:00Z', { title: 'szerda 00:30' });
    expect(shape([early, late], 'day')).toEqual([
      ['2026-10-21', ['szerda 00:30']],
      ['2026-10-20', ['kedd 23:30']],
    ]);
    // Ugyanez UTC-ben egy napra esne.
    expect(shape([early, late], 'day', 'UTC')).toEqual([['2026-10-20', ['szerda 00:30', 'kedd 23:30']]]);
  });

  it('más időzónával (New York) is a helyi napot használja', () => {
    expect(periodKey('2026-10-21T03:30:00Z', 'America/New_York', 'day')).toBe('2026-10-20');
  });
});

describe('nyári időszámítás váltása', () => {
  it('ősszel (2026. október 25., 25 órás nap) a nap első és utolsó órája egy csoportban', () => {
    // 00:30 CEST (UTC+2) és 23:30 CET (UTC+1): 24 órán túli különbség, mégis ugyanaz a helyi nap.
    const first = ev('2026-10-24T22:30:00Z', { title: '00:30 nyári idő' });
    const last = ev('2026-10-25T22:30:00Z', { title: '23:30 téli idő' });
    const next = ev('2026-10-25T23:30:00Z', { title: 'hétfő 00:30' });
    expect(shape([next, last, first], 'day')).toEqual([
      ['2026-10-26', ['hétfő 00:30']],
      ['2026-10-25', ['23:30 téli idő', '00:30 nyári idő']],
    ]);
    // A vasárnap a váltás hetéhez tartozik, a hétfő már a következőhöz.
    expect(shape([next, last, first], 'week')).toEqual([
      ['2026-10-26', ['hétfő 00:30']],
      ['2026-10-19', ['23:30 téli idő', '00:30 nyári idő']],
    ]);
  });

  it('tavasszal (2026. március 29., 23 órás nap) a határok helyesek', () => {
    expect(localDate('2026-03-28T22:59:59Z', TZ)).toBe('2026-03-28'); // 23:59:59 CET
    expect(localDate('2026-03-28T23:00:00Z', TZ)).toBe('2026-03-29'); // 00:00 CET
    expect(localDate('2026-03-29T21:59:59Z', TZ)).toBe('2026-03-29'); // 23:59:59 CEST
    expect(localDate('2026-03-29T22:00:00Z', TZ)).toBe('2026-03-30'); // 00:00 CEST, hétfő
    expect(periodKey('2026-03-29T21:59:59Z', TZ, 'week')).toBe('2026-03-23');
    expect(periodKey('2026-03-29T22:00:00Z', TZ, 'week')).toBe('2026-03-30');
  });
});

describe('hétfői hétkezdés', () => {
  it('a hét hétfőn kezdődik és vasárnap ér véget', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19'); // hétfő
    expect(weekStart('2026-10-21')).toBe('2026-10-19'); // szerda
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // vasárnap
    expect(weekStart('2026-10-26')).toBe('2026-10-26'); // hétfő
  });

  it('a vasárnap késő esti és a hétfő hajnali esemény két külön hétbe kerül (helyi idő szerint)', () => {
    const sunday = ev('2026-11-01T22:59:00Z', { title: 'vasárnap 23:59' });
    const monday = ev('2026-11-01T23:01:00Z', { title: 'hétfő 00:01' });
    const prevMonday = ev('2026-10-25T23:00:00Z', { title: 'előző hétfő 00:00' });
    expect(shape([monday, sunday, prevMonday], 'week')).toEqual([
      ['2026-11-02', ['hétfő 00:01']],
      ['2026-10-26', ['vasárnap 23:59', 'előző hétfő 00:00']],
    ]);
  });

  it('hónap- és évhatáron átnyúló hét; ISO hétsorszám', () => {
    expect(weekStart('2027-01-03')).toBe('2026-12-28');
    expect(isoWeek('2026-12-31')).toBe(53);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2027-01-04')).toBe(1);
    expect(isoWeek('2026-10-20')).toBe(43);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('típus szerinti csoportosítás', () => {
  it('egy időszakon belül az azonos típusú események egy csoportba kerülnek, a legújabb helyén', () => {
    const a1 = ev('2026-10-20T10:00:00Z', { type: 'core.project_updated', title: 'm3' });
    const b1 = ev('2026-10-20T09:00:00Z', { type: 'core.member_added', title: 'h1' });
    const a2 = ev('2026-10-20T08:00:00Z', { type: 'core.project_updated', title: 'm2' });
    const a3 = ev('2026-10-19T08:00:00Z', { type: 'core.project_updated', title: 'm1' });
    const groups = groupTimeline([a1, b1, a2, a3], { timeZone: TZ, period: 'day', byType: true });
    expect(groups).toHaveLength(2);
    const [today, yesterday] = groups;
    expect(today!.count).toBe(3);
    expect(today!.nodes.map((node) => node.kind)).toEqual(['type', 'event']);
    const typeNode = today!.nodes[0]!;
    expect(typeNode.kind === 'type' && typeNode.key).toBe('2026-10-20|core.project_updated');
    expect(typeNode.kind === 'type' && typeNode.items.map((i) => i.event.title)).toEqual(['m3', 'm2']);
    // Egyetlen eseményből nem lesz csoport.
    expect(yesterday!.nodes).toEqual([{ kind: 'event', event: a3, children: [] }]);
  });

  it('a kapcsolódó események (szülő-azonosító) a szülő alá kerülnek, ha a szülő be van töltve', () => {
    const survey = ev('2026-10-20T10:00:00Z', { type: 'notes.survey_created', title: 'felmérés' });
    const photo1 = ev('2026-10-20T10:00:05Z', { type: 'docs.file_uploaded', title: 'fotó 1', parentId: survey.id });
    const photo2 = ev('2026-10-20T10:00:06Z', { type: 'docs.file_uploaded', title: 'fotó 2', parentId: survey.id });
    const orphan = ev('2026-10-20T09:00:00Z', { type: 'docs.file_uploaded', title: 'árva', parentId: ev('2026-01-01T00:00:00Z').id });
    const [g] = groupTimeline([photo2, photo1, survey, orphan], { timeZone: TZ, period: 'day', byType: true });
    expect(g!.count).toBe(4);
    expect(g!.nodes).toEqual([
      { kind: 'event', event: survey, children: [photo2, photo1] },
      { kind: 'event', event: orphan, children: [] },
    ]);
  });
});

describe('időszak felirata', () => {
  it('nap: relatív megnevezés a mai naphoz képest', () => {
    expect(periodLabel('2026-10-20', 'day', '2026-10-20', LABELS)).toBe('Ma · 2026. október 20., kedd');
    expect(periodLabel('2026-10-19', 'day', '2026-10-20', LABELS)).toBe('Tegnap · 2026. október 19., hétfő');
    expect(periodLabel('2026-10-15', 'day', '2026-10-20', LABELS)).toBe('2026. október 15., csütörtök');
  });

  it('hét: sorszám és tartomány', () => {
    expect(periodLabel('2026-10-19', 'week', '2026-10-25', LABELS)).toBe('Ez a hét · 43. hét · 2026. október 19–25.');
    expect(periodLabel('2026-10-12', 'week', '2026-10-20', LABELS)).toBe('Múlt hét · 42. hét · 2026. október 12–18.');
    expect(periodLabel('2026-09-28', 'week', '2026-10-20', LABELS)).toBe('40. hét · 2026. szeptember 28. – október 4.');
  });
});
