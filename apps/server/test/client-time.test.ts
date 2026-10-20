import { describe, expect, it } from 'vitest';
import { CLIENT_TIME_MAX_AGE_MS, clientTime } from '../src/core/client-time.ts';

const now = new Date('2026-10-20T12:00:00Z');

describe('clientTime (a kliens oldali időbélyeg az esemény idejéhez)', () => {
  it('a múltbeli, 30 napon belüli időpontot elfogadja', () => {
    expect(clientTime('2026-10-20T09:15:00Z', now)).toEqual(new Date('2026-10-20T09:15:00Z'));
    expect(clientTime('2026-10-20T11:15:00+02:00', now)).toEqual(new Date('2026-10-20T09:15:00Z'));
    expect(clientTime(new Date(now.getTime() - CLIENT_TIME_MAX_AGE_MS).toISOString(), now)).toEqual(new Date(now.getTime() - CLIENT_TIME_MAX_AGE_MS));
  });

  it('a jövőbeli időpont (siető óra) helyett a szerver ideje', () => {
    expect(clientTime('2026-10-20T12:05:00Z', now)).toEqual(now);
  });

  it('a 30 napnál régebbi, a hiányzó és az érvénytelen időpontot nem használja', () => {
    expect(clientTime(new Date(now.getTime() - CLIENT_TIME_MAX_AGE_MS - 1).toISOString(), now)).toBeUndefined();
    expect(clientTime(undefined, now)).toBeUndefined();
    expect(clientTime(null, now)).toBeUndefined();
    expect(clientTime('nem dátum', now)).toBeUndefined();
  });
});
