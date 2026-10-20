import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKLOG_LIMIT } from '../src/core/stream.ts';
import { createTestApp, login, type TestContext } from './helpers.ts';
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
