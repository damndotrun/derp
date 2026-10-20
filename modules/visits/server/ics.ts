import { createHmac, randomBytes } from 'node:crypto';
import ical, { ICalEventStatus } from 'ical-generator';
import type { Visit } from '../shared/schemas.ts';

// Kollégánkénti, csak olvasható ICS-feed (`GET /api/ics/<token>.ics`). A token véletlen 32 bájt (base64url); az
// adatbázisban csak a HMAC-SHA256(ICS_TOKEN_PEPPER, token) hash-e van, így egy adatbázis-mentésből a feed nem érhető el.

/** Fejlesztéskor és tesztben használt pepper, ha az `ICS_TOKEN_PEPPER` nincs megadva. Élesben nem engedett. */
const DEV_PEPPER = 'derp-dev-ics-token-pepper-not-for-production';

/** Az ICS-feed múltbeli része: ennyi napnál régebben kezdődő kiszállás nem kerül a feedbe. */
export const FEED_PAST_DAYS = 90;

export class PepperError extends Error {}

/**
 * Az `ICS_TOKEN_PEPPER` (min. 32 bájt). A spec szerint kötelező, ha a `visits` modul aktív: `NODE_ENV=production`
 * mellett hiányában a szerver nem indul el; tesztben és fejlesztéskor egy rögzített fejlesztői érték lép a helyére.
 */
export function resolvePepper(env: NodeJS.ProcessEnv, nodeEnv: string): string {
  const pepper = env.ICS_TOKEN_PEPPER?.trim();
  if (!pepper) {
    if (nodeEnv === 'production') throw new PepperError('ICS_TOKEN_PEPPER kötelező, ha a visits modul aktív');
    return DEV_PEPPER;
  }
  if (Buffer.byteLength(pepper, 'utf8') < 32) throw new PepperError('ICS_TOKEN_PEPPER legalább 32 bájt legyen');
  return pepper;
}

export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (pepper: string, token: string): string => createHmac('sha256', pepper).update(token).digest('hex');

/** A feed URL-jének utolsó része: `<token>.ics`; a token base64url (43 karakter). */
export const ICS_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

const STATUS_LABEL: Record<Visit['status'], string> = {
  utemezett: 'Ütemezett',
  folyamatban: 'Folyamatban',
  kesz: 'Kész',
  elmaradt: 'Elmaradt',
};

/** A kolléga kiszállásai ICS (RFC 5545) formában; az időpontok UTC-ben, a Google Naptár a saját zónájában mutatja. */
export function renderFeed(opts: { userName: string; visits: Visit[]; publicBaseUrl: string }): string {
  const cal = ical({
    name: `dERP kiszállások – ${opts.userName}`,
    prodId: { company: 'Doka Kft', product: 'dERP', language: 'HU' },
    ttl: 60 * 60,
  });
  for (const v of opts.visits) {
    const url = `${opts.publicBaseUrl}/projects/${v.projectId}`;
    const lines = [
      v.task,
      `Kollégák: ${v.assignees.map((a) => a.name).join(', ')}`,
      `Állapot: ${STATUS_LABEL[v.status]}`,
      v.clientName ? `Ügyfél: ${v.clientName}` : '',
      url,
    ].filter(Boolean);
    cal.createEvent({
      id: `${v.id}@derp`,
      sequence: v.version,
      start: new Date(v.startsAt),
      end: new Date(v.endsAt),
      summary: `Kiszállás: ${v.projectName}`,
      location: v.address || null,
      description: lines.join('\n'),
      url,
      status: v.status === 'elmaradt' ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    });
  }
  return cal.toString();
}
