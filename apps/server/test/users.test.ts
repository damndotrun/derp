import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from './helpers.ts';
import { openStream } from './sse.ts';

let ctx: TestContext;
let admin: ReturnType<typeof requester>;
let adminId: string;

beforeAll(async () => {
  ctx = await createTestApp({}, { streamPingMs: 60_000 });
  await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  admin = requester(ctx.app, await login(ctx.app));
  adminId = (await admin('GET', '/api/session')).json().user.id;
});
afterAll(() => ctx.close());

const uniqueEmail = () => `uj-${randomBytes(4).toString('hex')}@derp.test`;

describe('felhasználók', () => {
  it('a seed:e2e három felhasználót ad', async () => {
    const items = (await admin('GET', '/api/users')).json().items;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'admin@derp.test', name: 'Admin Ádám', role: 'admin', active: true }),
        expect.objectContaining({ email: 'iroda@derp.test', name: 'Iroda Ildi', role: 'iroda', active: true }),
        expect.objectContaining({ email: 'terepes@derp.test', name: 'Terepes Tamás', role: 'terepes', active: true }),
      ]),
    );
  });

  it('az admin felvesz egy felhasználót, aki utána be tud lépni; ugyanaz a cím másodszor 409', async () => {
    const email = uniqueEmail();
    const res = await admin('POST', '/api/users', { email, name: 'Új Kolléga', role: 'terepes' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email, role: 'terepes', active: true, version: 1 });
    await login(ctx.app, email);
    expect((await admin('POST', '/api/users', { email: email.toUpperCase(), name: 'Más', role: 'iroda' })).statusCode).toBe(409);
  });

  it('a listát az iroda is látja, a terepes nem; felvenni és módosítani csak az admin tud', async () => {
    const iroda = requester(ctx.app, await login(ctx.app, IRODA_EMAIL));
    const terepes = requester(ctx.app, await login(ctx.app, TEREPES_EMAIL));
    expect((await iroda('GET', '/api/users')).statusCode).toBe(200);
    expect((await terepes('GET', '/api/users')).statusCode).toBe(403);
    expect((await iroda('POST', '/api/users', { email: uniqueEmail(), name: 'X', role: 'admin' })).statusCode).toBe(403);
    const [u] = (await iroda('GET', '/api/users')).json().items;
    expect((await iroda('PATCH', `/api/users/${u.id}`, { version: u.version, role: 'admin' })).statusCode).toBe(403);
  });

  it('kikapcsolás: a munkamenet megszűnik, belépni nem lehet; visszakapcsolva újra igen', async () => {
    const email = uniqueEmail();
    const u = (await admin('POST', '/api/users', { email, name: 'Kilépő', role: 'iroda' })).json();
    const own = requester(ctx.app, await login(ctx.app, email));
    expect((await own('GET', '/api/projects')).statusCode).toBe(200);

    const off = await admin('PATCH', `/api/users/${u.id}`, { version: 1, active: false });
    expect(off.json()).toMatchObject({ active: false, version: 2 });
    expect((await own('GET', '/api/projects')).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/dev-login', payload: { email } })).statusCode).toBe(401);

    await admin('PATCH', `/api/users/${u.id}`, { version: 2, active: true });
    await login(ctx.app, email);
  });

  it('szerepkör-váltáskor a nyitott eseményfolyam lezárul', async () => {
    const email = uniqueEmail();
    const u = (await admin('POST', '/api/users', { email, name: 'Váltó', role: 'iroda' })).json();
    const cookie = await login(ctx.app, email);
    const s = await openStream(ctx.app, { cookie });
    await s.waitFor((m) => m.event === 'ready');
    await admin('PATCH', `/api/users/${u.id}`, { version: 1, role: 'terepes' });
    await expect(Promise.race([s.ended.then(() => 'lezárva'), new Promise((r) => setTimeout(() => r('nyitva'), 2000))])).resolves.toBe(
      'lezárva',
    );
    s.close();
  });

  it('a saját szerepkörét és állapotát az admin nem módosíthatja, a nevét igen', async () => {
    const me = (await admin('GET', '/api/users')).json().items.find((x: { id: string }) => x.id === adminId);
    expect((await admin('PATCH', `/api/users/${adminId}`, { version: me.version, role: 'iroda' })).statusCode).toBe(409);
    expect((await admin('PATCH', `/api/users/${adminId}`, { version: me.version, active: false })).statusCode).toBe(409);
    const renamed = await admin('PATCH', `/api/users/${adminId}`, { version: me.version, name: 'Admin Ádám' });
    expect(renamed.statusCode).toBe(200);
  });

  it('elavult verzióra 409', async () => {
    const u = (await admin('POST', '/api/users', { email: uniqueEmail(), name: 'Verzió', role: 'iroda' })).json();
    await admin('PATCH', `/api/users/${u.id}`, { version: 1, name: 'Verzió 2' });
    expect((await admin('PATCH', `/api/users/${u.id}`, { version: 1, name: 'Verzió 3' })).statusCode).toBe(409);
  });
});
