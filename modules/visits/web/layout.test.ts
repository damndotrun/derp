import { describe, expect, it } from 'vitest';
import type { Visit } from '../shared/schemas.ts';
import { colleagueRows, dayLabel, timeRange, viewDays } from './layout.ts';

const TZ = 'Europe/Budapest';
const tamas = { id: '00000000-0000-4000-8000-000000000001', name: 'Terepes Tamás' };
const ildi = { id: '00000000-0000-4000-8000-000000000002', name: 'Iroda Ildi' };

const visit = (id: string, startsAt: string, endsAt: string, assignees = [tamas]): Visit => ({
  id,
  projectId: '00000000-0000-4000-8000-0000000000aa',
  projectName: 'Minta projekt',
  clientName: null,
  startsAt,
  endsAt,
  address: '',
  task: '',
  status: 'utemezett',
  version: 1,
  assignees,
  conflicts: [],
});

describe('napi/heti nézet elrendezése', () => {
  it('a hét napjai hétfőtől, a kollégák név szerint, a közös kiszállás mindkettőjük sorában', () => {
    const days = viewDays('2026-10-19', 7);
    expect(days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    const shared = visit('a', '2026-10-20T07:00:00Z', '2026-10-20T09:00:00Z', [tamas, ildi]);
    const own = visit('b', '2026-10-22T12:00:00Z', '2026-10-22T13:00:00Z');
    const rows = colleagueRows([shared, own], days, TZ);
    expect(rows.map((r) => r.colleague.name)).toEqual(['Iroda Ildi', 'Terepes Tamás']);
    expect(rows[0]!.cells.map((c) => c.map((v) => v.id))).toEqual([[], ['a'], [], [], [], [], []]);
    expect(rows[1]!.cells.map((c) => c.map((v) => v.id))).toEqual([[], ['a'], [], ['b'], [], [], []]);
    expect(colleagueRows([shared, own], days, TZ, ildi.id).map((r) => r.colleague.name)).toEqual(['Iroda Ildi']);
  });

  it('a nap a TZ_DISPLAY szerint: az UTC szerint előző napi 23:30 budapesti idő szerint már a következő nap', () => {
    const late = visit('c', '2026-10-19T22:30:00Z', '2026-10-19T23:30:00Z');
    const rows = colleagueRows([late], viewDays('2026-10-19', 2), TZ);
    expect(rows[0]!.cells.map((c) => c.length)).toEqual([0, 1]);
  });

  it('az éjfélen átnyúló kiszállás mindkét napon látszik, a felirat jelzi a másnapot', () => {
    const night = visit('d', '2026-10-20T20:00:00Z', '2026-10-20T23:30:00Z'); // 22:00–01:30
    const rows = colleagueRows([night], viewDays('2026-10-20', 2), TZ);
    expect(rows[0]!.cells.map((c) => c.length)).toEqual([1, 1]);
    expect(timeRange(night, TZ, 'másnap')).toBe('22:00–01:30 (másnap)');
    expect(timeRange(visit('e', '2026-10-20T07:00:00Z', '2026-10-20T09:30:00Z'), TZ, 'másnap')).toBe('09:00–11:30');
  });

  it('a nap felirata magyarul', () => {
    expect(dayLabel('2026-10-19')).toBe('H 10. 19.');
    expect(dayLabel('2026-10-25')).toBe('V 10. 25.');
  });
});
