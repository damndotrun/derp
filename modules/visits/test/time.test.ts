import { describe, expect, it } from 'vitest';
import { addDays, localDate, localRange, localTime, overlaps, weekStart, zonedToUtc } from '../shared/time.ts';

const TZ = 'Europe/Budapest';

describe('időzóna-segédek (TZ_DISPLAY)', () => {
  it('a faliórás időpontot télen +1, nyáron +2 órás eltéréssel váltja UTC-re', () => {
    expect(zonedToUtc('2026-01-15', '08:00', TZ).toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(zonedToUtc('2026-07-15', '08:00', TZ).toISOString()).toBe('2026-07-15T06:00:00.000Z');
  });

  it('nyári időszámítás váltásakor: a kihagyott időpont előre tolódik, a kétszer előfordulóból a korábbi', () => {
    // 2026-03-29 02:00 → 03:00 (nincs 02:30), 2026-10-25 03:00 → 02:00 (a 02:30 kétszer van).
    expect(localTime(zonedToUtc('2026-03-29', '02:30', TZ), TZ)).toBe('03:30');
    expect(zonedToUtc('2026-10-25', '02:30', TZ).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('a helyi nap határai, a váltás napján 23, illetve 25 órával', () => {
    const spring = localRange('2026-03-29', 1, TZ);
    expect(spring.from.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(23);
    const autumn = localRange('2026-10-25', 1, TZ);
    expect((autumn.to.getTime() - autumn.from.getTime()) / 3_600_000).toBe(25);
  });

  it('a helyi dátum az időzóna szerint, a hét hétfőn kezdődik', () => {
    expect(localDate('2026-10-19T22:30:00Z', TZ)).toBe('2026-10-20');
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // vasárnap → előző hétfő
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('átfedés: a közös rész ütközés, az egymásba érő vég és kezdet nem', () => {
    const a = { startsAt: '2026-10-20T08:00:00Z', endsAt: '2026-10-20T10:00:00Z' };
    expect(overlaps(a, { startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T11:00:00Z' })).toBe(true);
    expect(overlaps(a, { startsAt: '2026-10-20T08:30:00Z', endsAt: '2026-10-20T09:00:00Z' })).toBe(true);
    expect(overlaps(a, { startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T11:00:00Z' })).toBe(false);
    expect(overlaps(a, { startsAt: '2026-10-20T06:00:00Z', endsAt: '2026-10-20T08:00:00Z' })).toBe(false);
  });
});
