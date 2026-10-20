import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKLOG_LIMIT } from '../src/core/stream.ts';
import { createTestApp, login, TEREPES_EMAIL, type TestContext } from './helpers.ts';
import { openStream, type SseClient } from './sse.ts';

let ctx: TestContext;
let cookie: string;
const streams: SseClient[] = [];

beforeAll(async () => {
  ctx = await createTestApp({}, { streamPingMs: 200 });
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  cookie = await login(ctx.app);
});
afterAll(async () => {
  streams.forEach((s) => s.close());
  await ctx.close();
});

const open = async (opts: { lastEventId?: string; withCookie?: boolean } = {}) => {
  const s = await openStream(ctx.app, { cookie: opts.withCookie === false ? undefined : cookie, lastEventId: opts.lastEventId });
  streams.push(s);
  return s;
};
const createProject = async (name: string) =>
  (await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name }, headers: { cookie } })).json();
const ready = (s: SseClient) => s.waitFor((m) => m.event === 'ready');

describe('GET /api/stream', () => {
  it('belépés nélkül 401', async () => {
    const s = await open({ withCookie: false });
    expect(s.status).toBe(401);
  });

  it('az új esemény LISTEN/NOTIFY-on át, sorszámmal érkezik', async () => {
    const s = await open();
    expect(s.status).toBe(200);
    const r = await ready(s);
    const p = await createProject('SSE próba');
    const msg = await s.waitFor((m) => m.event === 'event');
    expect(Number(msg.id)).toBeGreaterThan(Number(r.id));
    expect(JSON.parse(msg.data)).toMatchObject({
      projectId: p.id,
      type: 'core.project_created',
      title: 'Projekt létrehozva',
      actor: { name: 'Admin Ádám' },
    });
  });

  it('pingel (`: ping` komment)', async () => {
    const s = await open();
    await ready(s);
    const ping = await s.waitFor((m) => m.event === 'comment', 2000);
    expect(ping.data).toBe('');
  });

  it('Last-Event-ID után a kimaradt eseményeket sorrendben pótolja, utána élőben folytatja', async () => {
    const first = await open();
    const r = await ready(first);
    first.close();

    const a = await createProject('Kimaradt A');
    const b = await createProject('Kimaradt B');

    const s = await open({ lastEventId: r.id });
    const backlog = [await s.waitFor((m) => m.event === 'event'), await s.waitFor((m) => m.event === 'event')];
    expect(backlog.map((m) => JSON.parse(m.data).projectId)).toEqual([a.id, b.id]);
    const ready2 = await ready(s);
    expect(ready2.id).toBe(backlog[1]!.id);

    const c = await createProject('Élő C');
    const live = await s.waitFor((m) => m.event === 'event');
    expect(JSON.parse(live.data).projectId).toBe(c.id);
  });

  it('ha túl sok esemény maradt ki, `reset`-et küld', async () => {
    const first = await open();
    const r = await ready(first);
    first.close();
    await ctx.pool.query(
      `INSERT INTO events (type, source, title) SELECT 'core.bulk_probe', 'system', 'tömeges' FROM generate_series(1, $1::int)`,
      [BACKLOG_LIMIT + 1],
    );
    const s = await open({ lastEventId: r.id });
    const msg = await s.waitFor((m) => m.event === 'reset' || m.event === 'event');
    expect(msg.event).toBe('reset');
    const ready2 = await ready(s);
    expect(Number(ready2.id)).toBeGreaterThanOrEqual(Number(r.id) + BACKLOG_LIMIT + 1);
  });

  it('a lekérdezési paraméterben is megadható a folytatási pont', async () => {
    const first = await open();
    const r = await ready(first);
    first.close();
    const p = await createProject('Paraméteres');
    const s = await openStream(ctx.app, { cookie, path: `/api/stream?lastEventId=${r.id}` });
    streams.push(s);
    const msg = await s.waitFor((m) => m.event === 'event');
    expect(JSON.parse(msg.data).projectId).toBe(p.id);
  });
});

describe('GET /api/stream terepes-szűréssel', () => {
  const api = (method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: object) =>
    ctx.app.inject({ method, url, payload, headers: { cookie } });
  type Ev = { type: string; projectId: string | null; title: string };
  /** Az összes beérkező esemény addig, amíg egy a feltételnek megfelel (azzal együtt). */
  const until = async (s: SseClient, pred: (e: Ev) => boolean): Promise<Ev[]> => {
    const got: Ev[] = [];
    for (;;) {
      const m = await s.waitFor((x) => x.event === 'event');
      const e = JSON.parse(m.data) as Ev;
      got.push(e);
      if (pred(e)) return got;
    }
  };

  it('a terepes csak a hozzá rendelt projekt eseményeit kapja; a hozzárendelés élőben érvényesül', async () => {
    const tc = await login(ctx.app, TEREPES_EMAIL);
    const terepesId = (await ctx.app.inject({ method: 'GET', url: '/api/session', headers: { cookie: tc } })).json().user.id;
    const mine = await createProject('Terepes látja');
    const other = await createProject('Terepes nem látja');
    await api('PUT', `/api/projects/${mine.id}/members/${terepesId}`);

    const s = await openStream(ctx.app, { cookie: tc });
    streams.push(s);
    await ready(s);

    // Előbb a nem látható projekt és egy projekt nélküli esemény, utána a látható projekté: ha az elsők átjönnének,
    // előbb érkeznének.
    await api('PATCH', `/api/projects/${other.id}`, { version: 1, name: 'Nem látja (mód.)' });
    await ctx.pool.query("INSERT INTO events (type, source, title) VALUES ('core.global_probe', 'system', 'projekt nélküli')");
    await api('PATCH', `/api/projects/${mine.id}`, { version: 1, name: 'Látja (mód.)' });
    let got = await until(s, (e) => e.type === 'core.project_updated' && e.projectId === mine.id);
    expect(got.every((e) => e.projectId === mine.id)).toBe(true);

    // Hozzárendelés a kapcsolat élete alatt: a hozzárendelés eseménye és az utána jövők már átjönnek.
    await api('PUT', `/api/projects/${other.id}/members/${terepesId}`);
    await api('PATCH', `/api/projects/${other.id}`, { version: 2, name: 'Már látja' });
    got = await until(s, (e) => e.type === 'core.project_updated' && e.projectId === other.id);
    expect(got.map((e) => e.type)).toEqual(['core.member_added', 'core.project_updated']);

    // Levétel: a levétel eseményét még megkapja, az utána jövőket már nem.
    await api('DELETE', `/api/projects/${other.id}/members/${terepesId}`);
    await api('PATCH', `/api/projects/${other.id}`, { version: 3, name: 'Már nem látja' });
    await api('PATCH', `/api/projects/${mine.id}`, { version: 2, name: 'Látja (2)' });
    got = await until(s, (e) => e.type === 'core.project_updated' && e.projectId === mine.id);
    expect(got.map((e) => [e.type, e.projectId === other.id ? 'other' : 'mine'])).toEqual([
      ['core.member_removed', 'other'],
      ['core.project_updated', 'mine'],
    ]);
  });

  it('Last-Event-ID szerinti pótláskor is szűr', async () => {
    const tc = await login(ctx.app, TEREPES_EMAIL);
    const first = await openStream(ctx.app, { cookie: tc });
    const r = await ready(first);
    first.close();
    await createProject('Kimaradt, nem látható');
    const s = await openStream(ctx.app, { cookie: tc, lastEventId: r.id });
    streams.push(s);
    const msg = await s.waitFor((m) => m.event === 'event' || m.event === 'ready');
    expect(msg.event).toBe('ready');
  });
});
