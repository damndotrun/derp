import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventList, TimelineEvent } from '@derp/shared';
import { createTestApp, login, requester, TEREPES_EMAIL, type TestContext } from './helpers.ts';

let ctx: TestContext;
let api: ReturnType<typeof requester>;

beforeAll(async () => {
  ctx = await createTestApp();
  api = requester(ctx.app, await login(ctx.app));
});
afterAll(() => ctx.close());

async function newProject(name: string): Promise<string> {
  return (await api('POST', '/api/projects', { name })).json().id;
}

/** A projekt minden eseménye `limit` méretű lapokban, a `nextCursor` szerint végiglapozva. */
async function pageThrough(projectId: string, limit: number, query = ''): Promise<{ items: TimelineEvent[]; pages: number }> {
  const items: TimelineEvent[] = [];
  let before: string | null = null;
  let pages = 0;
  do {
    const res = await api('GET', `/api/projects/${projectId}/events?limit=${limit}${query}${before ? `&before=${before}` : ''}`);
    expect(res.statusCode).toBe(200);
    const page = res.json() as EventList;
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    before = page.nextCursor;
    pages++;
  } while (before && pages < 100);
  return { items, pages };
}

describe('idővonal: lapozás', () => {
  it('kurzorral végiglapozva minden esemény pontosan egyszer, időrendben fordítva jön', async () => {
    const id = await newProject('Lapozás');
    const res = await api('POST', '/api/test/events', {
      projectId: id,
      events: [
        { type: 'core.project_updated', title: 'E1', occurredAt: '2026-10-01T08:00:00Z' },
        // Három esemény ugyanabban az időpontban: a sorrendet az azonosító dönti el, a lapok határán sem vesznek el.
        { type: 'core.project_updated', title: 'E2', occurredAt: '2026-10-02T08:00:00Z' },
        { type: 'core.project_updated', title: 'E3', occurredAt: '2026-10-02T08:00:00Z' },
        { type: 'core.project_updated', title: 'E4', occurredAt: '2026-10-02T08:00:00Z' },
        { type: 'core.member_added', title: 'E5', occurredAt: '2026-10-03T08:00:00+02:00' },
        { type: 'core.project_updated', title: 'E6', occurredAt: '2026-10-05T23:59:59.999Z' },
      ],
    });
    expect(res.statusCode).toBe(201);

    const full = (await api('GET', `/api/projects/${id}/events`)).json() as EventList;
    expect(full.items).toHaveLength(7);
    expect(full.nextCursor).toBeNull();
    const times = full.items.map((e) => Date.parse(e.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    for (const limit of [1, 2, 3, 6]) {
      const { items } = await pageThrough(id, limit);
      expect(items.map((e) => e.id)).toEqual(full.items.map((e) => e.id));
    }
    const exact = await pageThrough(id, 7);
    expect(exact.pages).toBe(1);
  });

  it('a mikroszekundumban eltérő, de ugyanarra az ezredmásodpercre eső események sem vesznek el', async () => {
    const id = await newProject('Mikroszekundum');
    await ctx.pool.query(
      `INSERT INTO events (project_id, type, source, title, occurred_at) VALUES
        ($1, 'core.project_updated', 'test', 'µ1', '2026-10-10T10:00:00.123100Z'),
        ($1, 'core.project_updated', 'test', 'µ2', '2026-10-10T10:00:00.123456Z'),
        ($1, 'core.project_updated', 'test', 'µ3', '2026-10-10T10:00:00.123900Z')`,
      [id],
    );
    const { items } = await pageThrough(id, 1);
    expect(items.map((e) => e.title)).toEqual(['Projekt létrehozva', 'µ3', 'µ2', 'µ1']);
  });

  it('idegen projekt eseménye kurzorként nem ad vissza semmit', async () => {
    const a = await newProject('Kurzor A');
    const b = await newProject('Kurzor B');
    const foreign = (await api('GET', `/api/projects/${b}/events`)).json().items[0].id;
    const res = (await api('GET', `/api/projects/${a}/events?before=${foreign}`)).json();
    expect(res).toEqual({ items: [], nextCursor: null });
    expect((await api('GET', `/api/projects/${a}/events?before=nem-uuid`)).statusCode).toBe(400);
  });
});

describe('idővonal: típusszűrés', () => {
  it('a types paraméter szerint szűr, a lapozással együtt is; a típuslista darabszámot ad', async () => {
    const id = await newProject('Szűrés');
    await api('POST', '/api/test/events', {
      projectId: id,
      events: [
        ...Array.from({ length: 5 }, (_, i) => ({ type: 'core.project_updated', title: `M${i}` })),
        ...Array.from({ length: 3 }, (_, i) => ({ type: 'core.member_added', title: `H${i}`, data: { userId: randomUUID() } })),
      ],
    });

    const updated = await pageThrough(id, 2, '&types=core.project_updated');
    expect(updated.items).toHaveLength(5);
    expect(new Set(updated.items.map((e) => e.type))).toEqual(new Set(['core.project_updated']));

    const two = (await api('GET', `/api/projects/${id}/events?types=core.member_added,core.project_created`)).json();
    expect(two.items.map((e: TimelineEvent) => e.type).sort()).toEqual([
      'core.member_added',
      'core.member_added',
      'core.member_added',
      'core.project_created',
    ]);
    // Üres paraméter = mind.
    expect((await api('GET', `/api/projects/${id}/events?types=`)).json().items).toHaveLength(9);
    expect((await api('GET', `/api/projects/${id}/events?types=Rossz típus`)).statusCode).toBe(400);

    expect((await api('GET', `/api/projects/${id}/event-types`)).json()).toEqual({
      items: [
        { type: 'core.member_added', count: 3 },
        { type: 'core.project_created', count: 1 },
        { type: 'core.project_updated', count: 5 },
      ],
    });
  });
});

describe('idővonal: jogosultság', () => {
  it('a terepes nem hozzá rendelt projektre 403-at kap az eseményekre és a típuslistára is', async () => {
    const id = await newProject('Idegen idővonal');
    const terepes = requester(ctx.app, await login(ctx.app, TEREPES_EMAIL));
    expect((await terepes('GET', `/api/projects/${id}/events`)).statusCode).toBe(403);
    expect((await terepes('GET', `/api/projects/${id}/event-types`)).statusCode).toBe(403);
    expect((await terepes('POST', '/api/test/events', { projectId: id, events: [{ type: 'core.project_updated', title: 'x' }] })).statusCode).toBe(403);
    expect((await api('GET', `/api/projects/${randomUUID()}/event-types`)).statusCode).toBe(404);
  });
});

describe('teszt-végpont', () => {
  it('a szülő-eseményt és az adatot megtartja', async () => {
    const id = await newProject('Szülő');
    const [parent] = (await api('POST', '/api/test/events', { projectId: id, events: [{ type: 'core.project_updated', title: 'Szülő' }] })).json().ids;
    await api('POST', '/api/test/events', {
      projectId: id,
      events: [{ type: 'core.project_updated', title: 'Gyerek', parentId: parent, data: { a: 1 } }],
    });
    const child = (await api('GET', `/api/projects/${id}/events?limit=1`)).json().items[0];
    expect(child).toMatchObject({ title: 'Gyerek', parentId: parent, data: { a: 1 }, source: 'test' });
  });

  it('NODE_ENV=test nélkül nincs regisztrálva', async () => {
    const other = await createTestApp({ NODE_ENV: 'development' });
    try {
      const otherApi = requester(other.app, await login(other.app));
      const id = (await otherApi('POST', '/api/projects', { name: 'Fejlesztői' })).json().id;
      const res = await otherApi('POST', '/api/test/events', { projectId: id, events: [{ type: 'core.project_updated', title: 'x' }] });
      expect(res.statusCode).toBe(404);
    } finally {
      await other.close();
    }
  });
});
