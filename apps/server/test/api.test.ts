import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestApp, login, type TestContext } from './helpers.ts';

let ctx: TestContext;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp();
  cookie = await login(ctx.app);
});
afterAll(() => ctx.close());

const api = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, withCookie = true) =>
  ctx.app.inject({ method, url, payload, headers: withCookie ? { cookie } : {} });

describe('health', () => {
  it('belépés nélkül 200 és ellenőrzi az adatbázist', async () => {
    const res = await api('GET', '/api/health', undefined, false);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});

describe('belépés', () => {
  it('a session végpont belépés nélkül is válaszol', async () => {
    const res = await api('GET', '/api/session', undefined, false);
    expect(res.json()).toEqual({ user: null, devLogin: true, googleLogin: false, tzDisplay: 'Europe/Budapest' });
  });

  it('dev-login létező felhasználóval munkamenetet ad', async () => {
    const res = await api('GET', '/api/session');
    expect(res.json().user).toMatchObject({ email: ADMIN_EMAIL, name: 'Admin Ádám', role: 'admin' });
  });

  it('dev-login ismeretlen e-mail-címre 401', async () => {
    const res = await api('POST', '/api/dev-login', { email: 'senki@derp.test' }, false);
    expect(res.statusCode).toBe(401);
  });

  it('kis- és nagybetűtől függetlenül azonosít', async () => {
    const res = await api('POST', '/api/dev-login', { email: 'ADMIN@derp.test' }, false);
    expect(res.statusCode).toBe(200);
  });

  it('DEV_LOGIN=0 mellett a dev-login végpont nincs regisztrálva', async () => {
    const other = await createTestApp({ DEV_LOGIN: '0' });
    try {
      const res = await other.app.inject({ method: 'POST', url: '/api/dev-login', payload: { email: ADMIN_EMAIL } });
      expect(res.statusCode).toBe(404);
    } finally {
      await other.close();
    }
  });

  it('hamisított sütivel nincs belépés', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: 'derp_session=abc.def' } });
    expect(res.statusCode).toBe(401);
  });

  it('kilépés után a süti érvénytelen', async () => {
    const own = await login(ctx.app);
    await ctx.app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: own } });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: own } });
    expect(res.statusCode).toBe(401);
  });
});

describe('projektek', () => {
  it('belépés nélkül 401', async () => {
    expect((await api('GET', '/api/projects', undefined, false)).statusCode).toBe(401);
    expect((await api('POST', '/api/projects', { name: 'X' }, false)).statusCode).toBe(401);
  });

  it('létrehozás → „Projekt létrehozva” esemény', async () => {
    const client = (await api('POST', '/api/clients', { name: 'Minta Kft.' })).json();
    const created = await api('POST', '/api/projects', { name: 'Minta Kft. – légtechnika felmérés', clientId: client.id });
    expect(created.statusCode).toBe(201);
    const project = created.json();
    expect(project).toMatchObject({
      name: 'Minta Kft. – légtechnika felmérés',
      client: { id: client.id, name: 'Minta Kft.' },
      version: 1,
    });

    const events = (await api('GET', `/api/projects/${project.id}/events`)).json().items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      projectId: project.id,
      type: 'core.project_created',
      source: 'user',
      title: 'Projekt létrehozva',
      actor: { name: 'Admin Ádám' },
      data: { name: 'Minta Kft. – légtechnika felmérés', client: { id: client.id, name: 'Minta Kft.' } },
      parentId: null,
    });

    const list = (await api('GET', '/api/projects')).json().items;
    expect(list.map((p: { id: string }) => p.id)).toContain(project.id);
  });

  it('érvénytelen bemenetre 400', async () => {
    const res = await api('POST', '/api/projects', { name: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('módosítás verzióellenőrzéssel, eseménnyel', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Régi név' })).json();
    const ok = await api('PATCH', `/api/projects/${p.id}`, { version: 1, name: 'Új név' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Új név', version: 2 });

    const stale = await api('PATCH', `/api/projects/${p.id}`, { version: 1, name: 'Ütköző' });
    expect(stale.statusCode).toBe(409);

    const events = (await api('GET', `/api/projects/${p.id}/events`)).json().items;
    expect(events.map((e: { type: string }) => e.type)).toEqual(['core.project_updated', 'core.project_created']);
    expect(events[0].data).toEqual({ changes: { name: { from: 'Régi név', to: 'Új név' } } });
  });

  it('változás nélküli módosítás nem emel verziót és nem ír eseményt', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Ugyanaz' })).json();
    const res = await api('PATCH', `/api/projects/${p.id}`, { version: 1, name: 'Ugyanaz' });
    expect(res.json().version).toBe(1);
    expect((await api('GET', `/api/projects/${p.id}/events`)).json().items).toHaveLength(1);
  });

  it('törlés után 404, az események megmaradnak', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Törlendő' })).json();
    expect((await api('DELETE', `/api/projects/${p.id}`)).statusCode).toBe(204);
    expect((await api('GET', `/api/projects/${p.id}`)).statusCode).toBe(404);
    expect((await api('GET', `/api/projects/${p.id}/events`)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/projects/${p.id}`)).statusCode).toBe(404);
    const { rows } = await ctx.pool.query('SELECT type FROM events WHERE project_id = $1 ORDER BY occurred_at', [p.id]);
    expect(rows.map((r) => r.type)).toEqual(['core.project_created', 'core.project_deleted']);
  });

  it('ismeretlen és hibás azonosítóra 404 / 400', async () => {
    expect((await api('GET', `/api/projects/${randomUUID()}`)).statusCode).toBe(404);
    expect((await api('GET', `/api/projects/${randomUUID()}/events`)).statusCode).toBe(404);
    expect((await api('GET', '/api/projects/nem-uuid')).statusCode).toBe(400);
  });
});

describe('eseménynapló', () => {
  it('csak hozzáfűzhető: UPDATE és DELETE tiltott', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Napló' })).json();
    await expect(ctx.pool.query("UPDATE events SET title = 'x' WHERE project_id = $1", [p.id])).rejects.toThrow(
      /csak hozzáfűzés/,
    );
    await expect(ctx.pool.query('DELETE FROM events WHERE project_id = $1', [p.id])).rejects.toThrow(/csak hozzáfűzés/);
  });

  it('a típusnak <modul>.<esemény> alakúnak kell lennie', async () => {
    await expect(
      ctx.pool.query("INSERT INTO events (type, source, title) VALUES ('rossz', 'system', 'x')"),
    ).rejects.toThrow(/check constraint/);
  });

  it('időrendben fordítva, a limit szerint ad vissza', async () => {
    const p = (await api('POST', '/api/projects', { name: 'Sorrend' })).json();
    for (const name of ['A', 'B', 'C']) {
      const cur = (await api('GET', `/api/projects/${p.id}`)).json();
      await api('PATCH', `/api/projects/${p.id}`, { version: cur.version, name });
    }
    const all = (await api('GET', `/api/projects/${p.id}/events`)).json().items;
    expect(all.map((e: { data: { changes?: { name: { to: string } } } }) => e.data.changes?.name.to ?? 'létrehozva')).toEqual([
      'C',
      'B',
      'A',
      'létrehozva',
    ]);
    expect((await api('GET', `/api/projects/${p.id}/events?limit=2`)).json().items).toHaveLength(2);
    expect((await api('GET', `/api/projects/${p.id}/events?limit=0`)).statusCode).toBe(400);
  });
});

describe('adatvédelmi tájékoztató', () => {
  it('a /adatvedelem belépés nélkül 200, önálló HTML', async () => {
    const res = await api('GET', '/adatvedelem', undefined, false);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toContain('<h1>Adatvédelmi tájékoztató</h1>');
    expect(res.body).toContain('gmail.readonly');
  });
});
