import ICAL from 'ical.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  createTestApp,
  IRODA_EMAIL,
  login,
  requester,
  TEREPES_EMAIL,
  type TestContext,
} from '../../../apps/server/test/helpers.ts';
import type { MineResponse, Visit, VisitList } from '../shared/schemas.ts';
import { PepperError, resolvePepper } from '../server/ics.ts';

let ctx: TestContext;
let iroda: ReturnType<typeof requester>;
let tamas: ReturnType<typeof requester>;
let anon: ReturnType<typeof requester>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ctx = await createTestApp({ DERP_MODULES: 'visits', PUBLIC_BASE_URL: 'https://derp.example.test' });
  iroda = requester(ctx.app, await login(ctx.app, IRODA_EMAIL));
  tamas = requester(ctx.app, await login(ctx.app, TEREPES_EMAIL));
  anon = requester(ctx.app);
  const users = (await iroda('GET', '/api/users')).json().items as Array<{ id: string; email: string }>;
  for (const [key, email] of [['admin', ADMIN_EMAIL], ['iroda', IRODA_EMAIL], ['tamas', TEREPES_EMAIL]] as const) {
    ids[key] = users.find((u) => u.email === email)!.id;
  }
});
afterAll(() => ctx.close());

let seq = 0;
/** Minden teszt saját, távoli napot kap (közte egy üres nappal), hogy a közös adatbázisban ne ütközzenek egymással. */
const freshDay = () => `2031-0${1 + Math.floor(seq / 14)}-${String((seq++ % 14) * 2 + 2).padStart(2, '0')}`;
const nextDay = (day: string, n = 1) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** Budapesti idő télen: UTC+1. */
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+01:00`).toISOString();

async function project(name: string, members: string[] = []): Promise<string> {
  const p = (await iroda('POST', '/api/projects', { name })).json();
  for (const m of members) expect((await iroda('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

async function schedule(body: Record<string, unknown>): Promise<Visit> {
  const res = await iroda('POST', '/api/visits', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('kiszállás felvétele', () => {
  it('létrejön, és „Kiszállás ütemezve” esemény kerül az idővonalra', async () => {
    const day = freshDay();
    const projectId = await project('Kiszállás próba', [ids.tamas!]);
    const v = await schedule({
      projectId,
      assigneeIds: [ids.tamas],
      startsAt: at(day, '09:00'),
      endsAt: at(day, '11:00'),
      address: 'Kecskemét, Fő utca 1.',
      task: 'Légtechnikai felmérés',
    });
    expect(v).toMatchObject({
      projectId,
      projectName: 'Kiszállás próba',
      status: 'utemezett',
      address: 'Kecskemét, Fő utca 1.',
      assignees: [{ id: ids.tamas, name: 'Terepes Tamás' }],
      conflicts: [],
      version: 1,
    });
    const events = (await iroda('GET', `/api/projects/${projectId}/events?types=visits.scheduled`)).json().items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'visits.scheduled',
      title: 'Kiszállás ütemezve',
      actor: { name: 'Iroda Ildi' },
      data: { visitId: v.id, startsAt: v.startsAt, address: 'Kecskemét, Fő utca 1.', assignees: [{ name: 'Terepes Tamás' }] },
    });
  });

  it('érvénytelen adatra 400: vége a kezdés előtt, nincs kolléga, a terepes nincs a projekthez rendelve', async () => {
    const day = freshDay();
    const projectId = await project('Hibás kiszállás');
    const base = { projectId, assigneeIds: [ids.iroda], startsAt: at(day, '09:00'), endsAt: at(day, '10:00') };
    expect((await iroda('POST', '/api/visits', { ...base, endsAt: at(day, '08:00') })).statusCode).toBe(400);
    expect((await iroda('POST', '/api/visits', { ...base, assigneeIds: [] })).statusCode).toBe(400);
    expect((await iroda('POST', '/api/visits', { ...base, assigneeIds: [crypto.randomUUID()] })).statusCode).toBe(400);
    const outside = await iroda('POST', '/api/visits', { ...base, assigneeIds: [ids.tamas] });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.message).toContain('Terepes Tamás');
    // Az irodai kolléga projekt-hozzárendelés nélkül is beosztható (minden projektet lát).
    expect((await iroda('POST', '/api/visits', base)).statusCode).toBe(201);
  });

  it('kiszállást csak az iroda vesz fel, módosít és töröl; a terepes 403-at kap', async () => {
    const day = freshDay();
    const projectId = await project('Jogosultság próba', [ids.tamas!]);
    const body = { projectId, assigneeIds: [ids.tamas], startsAt: at(day, '09:00'), endsAt: at(day, '10:00') };
    expect((await tamas('POST', '/api/visits', body)).statusCode).toBe(403);
    const v = await schedule(body);
    expect((await tamas('PATCH', `/api/visits/${v.id}`, { version: 1, status: 'kesz' })).statusCode).toBe(403);
    expect((await tamas('DELETE', `/api/visits/${v.id}`)).statusCode).toBe(403);
    expect((await anon('GET', '/api/visits/mine')).statusCode).toBe(401);
  });
});

describe('ütközés', () => {
  it('ugyanannak a kollégának átfedő kiszállásai ütköznek; az egymásba érő, a más kollégájú és az elmaradt nem', async () => {
    const day = freshDay();
    const p1 = await project('Ütközés A', [ids.tamas!]);
    const p2 = await project('Ütközés B', [ids.tamas!]);
    const first = await schedule({ projectId: p1, assigneeIds: [ids.tamas], startsAt: at(day, '09:00'), endsAt: at(day, '12:00') });

    const second = await schedule({
      projectId: p2,
      assigneeIds: [ids.tamas, ids.iroda],
      startsAt: at(day, '11:00'),
      endsAt: at(day, '13:00'),
    });
    expect(second.conflicts).toEqual([
      {
        visitId: first.id,
        userId: ids.tamas,
        userName: 'Terepes Tamás',
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        projectName: 'Ütközés A',
      },
    ]);

    // Egymásba érő (12:00-kor kezdődik, amikor az első véget ér): nem ütközés az elsővel, de a másodikkal igen.
    const touching = await schedule({ projectId: p1, assigneeIds: [ids.tamas], startsAt: at(day, '13:00'), endsAt: at(day, '14:00') });
    expect(touching.conflicts).toEqual([]);
    // Más kolléga ugyanakkor: nem ütközik.
    const other = await schedule({ projectId: p1, assigneeIds: [ids.admin], startsAt: at(day, '09:00'), endsAt: at(day, '12:00') });
    expect(other.conflicts).toEqual([]);

    // A heti nézetben az ütközés mindkét oldalon látszik.
    const list = (
      await iroda('GET', `/api/visits?from=${encodeURIComponent(at(day, '00:00'))}&to=${encodeURIComponent(at(day, '23:59'))}`)
    ).json() as VisitList;
    const byId = new Map(list.items.map((v) => [v.id, v]));
    expect(byId.get(first.id)!.conflicts.map((c) => c.visitId)).toEqual([second.id]);
    expect(byId.get(second.id)!.conflicts.map((c) => c.visitId)).toEqual([first.id]);

    // Az elmaradt kiszállás nem ütközik.
    const res = await iroda('PATCH', `/api/visits/${first.id}`, { version: 1, status: 'elmaradt' });
    expect(res.statusCode).toBe(200);
    expect(res.json().conflicts).toEqual([]);
    expect((await iroda('GET', `/api/visits/${second.id}`)).json().conflicts).toEqual([]);
  });

  it('a terepes nem látja más projekt nevét az ütközésben', async () => {
    const day = freshDay();
    const mine = await project('Tamás látja', [ids.tamas!]);
    const hidden = await project('Tamás nem látja', [ids.tamas!]);
    const a = await schedule({ projectId: hidden, assigneeIds: [ids.tamas], startsAt: at(day, '09:00'), endsAt: at(day, '12:00') });
    const b = await schedule({ projectId: mine, assigneeIds: [ids.tamas], startsAt: at(day, '10:00'), endsAt: at(day, '11:00') });
    expect((await iroda('DELETE', `/api/projects/${hidden}/members/${ids.tamas}`)).statusCode).toBe(204);
    const seen = (await tamas('GET', `/api/visits/${b.id}`)).json() as Visit;
    expect(seen.conflicts).toEqual([expect.objectContaining({ visitId: a.id, projectName: null })]);
    expect((await tamas('GET', `/api/visits/${a.id}`)).statusCode).toBe(403);
  });
});

describe('napi/heti nézet és „Mai kiszállásaim”', () => {
  it('a terepes a saját napját kapja a dátum szerint, más kolléga kiszállását nem', async () => {
    const day = freshDay();
    const projectId = await project('Mai nap próba', [ids.tamas!]);
    const v = await schedule({ projectId, assigneeIds: [ids.tamas], startsAt: at(day, '08:00'), endsAt: at(day, '09:30') });
    const colleague = await schedule({ projectId, assigneeIds: [ids.iroda], startsAt: at(day, '10:00'), endsAt: at(day, '11:00') });
    // Késő este kezdődő, éjfélen átnyúló kiszállás mindkét napon látszik.
    const night = await schedule({ projectId, assigneeIds: [ids.tamas], startsAt: at(day, '23:00'), endsAt: at(nextDay(day), '01:00') });

    const mine = (await tamas('GET', `/api/visits/mine?date=${day}`)).json() as MineResponse;
    expect(mine.date).toBe(day);
    expect(mine.items.map((i) => i.id)).toEqual([v.id, night.id]);

    const next = (await tamas('GET', `/api/visits/mine?date=${nextDay(day)}`)).json() as MineResponse;
    expect(next.items.map((i) => i.id)).toEqual([night.id]);
    // Az előző nap üres (a 08:00-s kezdés budapesti idő szerint értendő, UTC-ben 07:00).
    expect(((await tamas('GET', `/api/visits/mine?date=${nextDay(day, -1)}`)).json() as MineResponse).items).toEqual([]);

    // A heti nézetben a terepes csak a sajátját látja, az iroda mindet, kollégára szűrve is.
    const q = `from=${encodeURIComponent(at(day, '00:00'))}&to=${encodeURIComponent(at(day, '23:59'))}`;
    const tamasWeek = (await tamas('GET', `/api/visits?${q}`)).json() as VisitList;
    expect(tamasWeek.items.map((i) => i.id)).toEqual([v.id, night.id]);
    expect((await tamas('GET', `/api/visits/${colleague.id}`)).statusCode).toBe(403);
    const all = (await iroda('GET', `/api/visits?${q}`)).json() as VisitList;
    expect(all.items.map((i) => i.id)).toEqual([v.id, colleague.id, night.id]);
    const onlyIldi = (await iroda('GET', `/api/visits?${q}&userId=${ids.iroda}`)).json() as VisitList;
    expect(onlyIldi.items.map((i) => i.id)).toEqual([colleague.id]);
  });

  it('dátum nélkül a mai napot adja a TZ_DISPLAY szerint; hibás dátumra és túl hosszú időszakra 400', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
    expect(((await tamas('GET', '/api/visits/mine')).json() as MineResponse).date).toBe(today);
    expect((await tamas('GET', '/api/visits/mine?date=2026-13-01')).statusCode).toBe(400);
    expect((await iroda('GET', '/api/visits?from=2031-01-01T00:00:00Z&to=2031-06-01T00:00:00Z')).statusCode).toBe(400);
  });

  it('a törölt projekt kiszállásai eltűnnek a nézetekből', async () => {
    const day = freshDay();
    const projectId = await project('Törlendő projekt', [ids.tamas!]);
    await schedule({ projectId, assigneeIds: [ids.tamas], startsAt: at(day, '08:00'), endsAt: at(day, '09:00') });
    expect((await iroda('DELETE', `/api/projects/${projectId}`)).statusCode).toBe(204);
    expect(((await tamas('GET', `/api/visits/mine?date=${day}`)).json() as MineResponse).items).toEqual([]);
  });
});

describe('módosítás és törlés', () => {
  it('verziószámmal módosít (eltérésnél 409), a változásról esemény készül; törléskor rejtve lesz', async () => {
    const day = freshDay();
    const projectId = await project('Módosítás próba', [ids.tamas!]);
    const v = await schedule({ projectId, assigneeIds: [ids.tamas], startsAt: at(day, '08:00'), endsAt: at(day, '09:00') });

    const res = await iroda('PATCH', `/api/visits/${v.id}`, {
      version: 1,
      endsAt: at(day, '10:00'),
      assigneeIds: [ids.tamas, ids.iroda],
      status: 'folyamatban',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ version: 2, status: 'folyamatban', endsAt: at(day, '10:00') });
    expect(res.json().assignees.map((a: { name: string }) => a.name)).toEqual(['Iroda Ildi', 'Terepes Tamás']);
    expect((await iroda('PATCH', `/api/visits/${v.id}`, { version: 1, task: 'x' })).statusCode).toBe(409);
    expect((await iroda('PATCH', `/api/visits/${v.id}`, { version: 2, startsAt: at(day, '11:00') })).statusCode).toBe(400);

    const updated = (await iroda('GET', `/api/projects/${projectId}/events?types=visits.updated`)).json().items;
    expect(updated[0]).toMatchObject({ title: 'Kiszállás módosítva', data: { changed: ['endsAt', 'status', 'assignees'] } });

    expect((await iroda('DELETE', `/api/visits/${v.id}`)).statusCode).toBe(204);
    expect((await iroda('GET', `/api/visits/${v.id}`)).statusCode).toBe(404);
    expect((await iroda('DELETE', `/api/visits/${v.id}`)).statusCode).toBe(404);
    const cancelled = (await iroda('GET', `/api/projects/${projectId}/events?types=visits.cancelled`)).json().items;
    expect(cancelled[0]).toMatchObject({ title: 'Kiszállás törölve', data: { visitId: v.id } });
  });
});

describe('ICS-feed', () => {
  const parse = (text: string) =>
    new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));

  it('a tokenes feed belépés nélkül, ical.js-szel visszaolvasva a kolléga kiszállásait adja', async () => {
    const day = freshDay();
    const projectId = await project('ICS próba', [ids.tamas!]);
    const v = await schedule({
      projectId,
      assigneeIds: [ids.tamas, ids.iroda],
      startsAt: at(day, '09:00'),
      endsAt: at(day, '11:30'),
      address: 'Kecskemét, Árpád körút 2.',
      task: 'Ventilátor cseréje',
    });
    const other = await schedule({ projectId, assigneeIds: [ids.iroda], startsAt: at(day, '13:00'), endsAt: at(day, '14:00') });

    expect((await tamas('GET', '/api/visits/ics-token')).json()).toEqual({ exists: false, createdAt: null });
    const created = await tamas('POST', '/api/visits/ics-token');
    expect(created.statusCode).toBe(201);
    const { url } = created.json() as { url: string };
    expect(url).toMatch(/^https:\/\/derp\.example\.test\/api\/ics\/[A-Za-z0-9_-]{43}\.ics$/);
    expect((await tamas('GET', '/api/visits/ics-token')).json()).toMatchObject({ exists: true });

    const res = await anon('GET', new URL(url).pathname);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    const calendar = new ICAL.Component(ICAL.parse(res.body));
    expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
    expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe('dERP kiszállások – Terepes Tamás');
    const events = parse(res.body);
    const ev = events.find((e) => e.uid === `${v.id}@derp`)!;
    expect(ev).toBeDefined();
    expect(ev.summary).toBe('Kiszállás: ICS próba');
    expect(ev.location).toBe('Kecskemét, Árpád körút 2.');
    expect(ev.startDate.toJSDate().toISOString()).toBe(v.startsAt);
    expect(ev.endDate.toJSDate().toISOString()).toBe(v.endsAt);
    expect(ev.description).toContain('Ventilátor cseréje');
    expect(ev.description).toContain('Kollégák: Iroda Ildi, Terepes Tamás');
    expect(ev.component.getFirstPropertyValue('status')).toBe('CONFIRMED');
    // Más kolléga kiszállása nincs Tamás feedjében.
    expect(events.find((e) => e.uid === `${other.id}@derp`)).toBeUndefined();

    // Elmaradt → CANCELLED; törölt → kikerül.
    await iroda('PATCH', `/api/visits/${v.id}`, { version: 1, status: 'elmaradt' });
    const cancelled = parse((await anon('GET', new URL(url).pathname)).body).find((e) => e.uid === `${v.id}@derp`)!;
    expect(cancelled.component.getFirstPropertyValue('status')).toBe('CANCELLED');
    await iroda('DELETE', `/api/visits/${v.id}`);
    expect(parse((await anon('GET', new URL(url).pathname)).body).find((e) => e.uid === `${v.id}@derp`)).toBeUndefined();
  });

  it('érvénytelen, formailag hibás és újragenerálás után régi tokenre 404', async () => {
    const first = (await iroda('POST', '/api/visits/ics-token')).json().url as string;
    expect((await anon('GET', new URL(first).pathname)).statusCode).toBe(200);
    const second = (await iroda('POST', '/api/visits/ics-token')).json().url as string;
    expect(second).not.toBe(first);
    expect((await anon('GET', new URL(first).pathname)).statusCode).toBe(404);
    expect((await anon('GET', new URL(second).pathname)).statusCode).toBe(200);

    const unknown = await anon('GET', `/api/ics/${'A'.repeat(43)}.ics`);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'not_found' } });
    expect((await anon('GET', '/api/ics/rovid.ics')).statusCode).toBe(404);
    expect((await anon('GET', `/api/ics/${'A'.repeat(43)}`)).statusCode).toBe(404);
  });

  it('kikapcsolt felhasználó feedje 404', async () => {
    const admin = requester(ctx.app, await login(ctx.app, ADMIN_EMAIL));
    const created = (
      await admin('POST', '/api/users', { email: `ics-${Date.now()}@derp.test`, name: 'ICS Kolléga', role: 'iroda' })
    ).json();
    const own = requester(ctx.app, await login(ctx.app, created.email));
    const url = (await own('POST', '/api/visits/ics-token')).json().url as string;
    expect((await anon('GET', new URL(url).pathname)).statusCode).toBe(200);
    expect((await admin('PATCH', `/api/users/${created.id}`, { version: created.version, active: false })).statusCode).toBe(200);
    expect((await anon('GET', new URL(url).pathname)).statusCode).toBe(404);
  });

  it('az ICS_TOKEN_PEPPER élesben kötelező és legalább 32 bájt', () => {
    expect(() => resolvePepper({}, 'production')).toThrow(PepperError);
    expect(() => resolvePepper({ ICS_TOKEN_PEPPER: 'rovid' }, 'production')).toThrow(/32 bájt/);
    expect(resolvePepper({ ICS_TOKEN_PEPPER: 'p'.repeat(32) }, 'production')).toBe('p'.repeat(32));
    expect(resolvePepper({}, 'test')).toBeTruthy();
  });
});
