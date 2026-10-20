// A kliens oldali időbélyeg (`capturedAt`): az offline sorban várt elem a terepen készült, nem a szerverre érkezéskor.

/** Ennél régebbi kliens oldali időpontot nem fogadunk el (spec: legfeljebb 30 nappal korábbi). */
export const CLIENT_TIME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Az esemény ideje a kliens időbélyegéből. A jövőbeli időpont (a telefon órája siet) a szerver ideje lesz; a 30
 * napnál régebbit, a hiányzót és az érvénytelent nem használjuk (`undefined`: a szerverre érkezés ideje marad).
 */
export function clientTime(capturedAt: string | null | undefined, now: Date = new Date()): Date | undefined {
  if (!capturedAt) return undefined;
  const at = new Date(capturedAt);
  if (Number.isNaN(at.getTime())) return undefined;
  if (at.getTime() > now.getTime()) return now;
  if (now.getTime() - at.getTime() > CLIENT_TIME_MAX_AGE_MS) return undefined;
  return at;
}
