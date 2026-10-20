import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, type TestContext } from '../../../apps/server/test/helpers.ts';
import { E2E_GREETING } from '../server/greeting.ts';

let ctx: TestContext;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp({ DERP_MODULES: 'example' });
  cookie = await login(ctx.app);
});
afterAll(() => ctx.close());

const api = (method: 'GET' | 'POST', url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: { cookie } });

describe('example modul', () => {
  it('a seedE2E hook beállítja az üdvözlést', async () => {
    expect((await api('GET', '/api/example/greeting')).json()).toEqual({ text: E2E_GREETING });
  });

  it('a minta esemény a projekt eseménynaplójába kerül', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Minta modul próba' })).json();
    const res = await api('POST', `/api/example/projects/${p.id}/ping`);
    expect(res.statusCode).toBe(201);
    const events = (await api('GET', `/api/projects/${p.id}/events`)).json().items;
    expect(events[0]).toMatchObject({
      id: res.json().eventId,
      type: 'example.pinged',
      title: 'Minta esemény',
      actor: { name: 'Admin Ádám' },
      data: { greeting: E2E_GREETING },
    });
  });

  it('ismeretlen projektre 404, belépés nélkül 401', async () => {
    expect((await api('POST', `/api/example/projects/${crypto.randomUUID()}/ping`)).statusCode).toBe(404);
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/example/greeting' });
    expect(anon.statusCode).toBe(401);
  });

  it('a manifestben fel nem vett eseménytípust nem írhatja', async () => {
    const { loadModules } = await import('../../../apps/server/src/core/modules.ts');
    const { createSeedContext } = await import('../../../apps/server/src/core/module-host.ts');
    const [example] = await loadModules(['example']);
    const seedCtx = createSeedContext(example!, ctx.db, ctx.pool);
    await expect(
      seedCtx.appendEvent({ projectId: null, type: 'example.unknown', source: 'system', title: 'x' }),
    ).rejects.toThrow(/nincs ilyen eseménytípus/);
  });

  it('kikapcsolva (DERP_MODULES üres) az útvonalai nincsenek regisztrálva', async () => {
    const off = await createTestApp({ DERP_MODULES: '' });
    try {
      const c = await login(off.app);
      const res = await off.app.inject({ method: 'GET', url: '/api/example/greeting', headers: { cookie: c } });
      expect(res.statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });
});
