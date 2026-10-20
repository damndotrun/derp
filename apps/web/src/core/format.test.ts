import { describe, expect, it } from 'vitest';
import { formatDateTime } from './format.ts';

describe('formatDateTime', () => {
  it('UTC-ből a megjelenítési időzónába vált, nyári és téli időszámítással', () => {
    // nyári idő: UTC+2
    expect(formatDateTime('2026-07-01T10:30:00Z', 'Europe/Budapest')).toBe('2026. 07. 01. 12:30');
    // téli idő: UTC+1
    expect(formatDateTime('2026-01-15T10:30:00Z', 'Europe/Budapest')).toBe('2026. 01. 15. 11:30');
  });

  it('napváltáskor a helyi dátumot mutatja', () => {
    expect(formatDateTime('2026-10-20T22:30:00Z', 'Europe/Budapest')).toBe('2026. 10. 21. 00:30');
  });
});
