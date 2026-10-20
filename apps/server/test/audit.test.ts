import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from './helpers.ts';

let ctx: TestContext;
let admin: ReturnType<typeof requester>;
let iroda: ReturnType<typeof requester>;
let irodaId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = requester(ctx.app, await login(ctx.app));
  iroda = requester(ctx.app, await login(ctx.app, IRODA_EMAIL));
  irodaId = (await iroda('GET', '/api/session')).json().user.id;
});
afterAll(() => ctx.close());

interface Entry {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  label: string;
  user: { id: string; name: string } | null;
  data: Record<string, unknown>;
}
const entries = async (query: string): Promise<Entry[]> => (await admin('GET', `/api/audit?${query}`)).json().items;

describe('auditnapló', () => {
  it('a projekt megtekintése, létrehozása és módosítása a naplóba kerül, ki és mit', async () => {
    const p = (await iroda('POST', '/api/projects', { name: 'Auditált projekt' })).json();
    await iroda('GET', `/api/projects/${p.id}`);
    await iroda('PATCH', `/api/projects/${p.id}`, { version: 1, name: 'Auditált projekt (2)' });

    const items = await entries(`entityType=project&entityId=${p.id}`);
    expect(items.map((e) => e.action)).toEqual(['update', 'view', 'create']);
    expect(items[1]).toMatchObject({ user: { id: irodaId, name: 'Iroda Ildi' }, label: 'Auditált projekt' });
    expect(items[0]!.data).toEqual({ changes: { name: { from: 'Auditált projekt', to: 'Auditált projekt (2)' } } });
  });

  it('az ügyfél-adatlap (kapcsolattartók elérhetősége) megtekintése is naplózott', async () => {
    const c = (await iroda('POST', '/api/clients', { name: 'Napló Kft.' })).json();
    await iroda('POST', `/api/clients/${c.id}/contacts`, { name: 'Kiss Ádám' });
    await iroda('GET', `/api/clients/${c.id}`);
    expect((await entries(`entityType=client&entityId=${c.id}`)).map((e) => e.action)).toEqual(['view', 'create']);
    expect((await entries('entityType=contact&action=create'))[0]).toMatchObject({ label: 'Kiss Ádám (Napló Kft.)' });
  });

  it('percen belüli ismételt megtekintést nem ír újra', async () => {
    const p = (await iroda('POST', '/api/projects', { name: 'Gyakran nézett' })).json();
    for (let i = 0; i < 3; i++) await iroda('GET', `/api/projects/${p.id}`);
    await admin('GET', `/api/projects/${p.id}`);
    const views = await entries(`entityType=project&entityId=${p.id}&action=view`);
    expect(views.map((e) => e.user?.name)).toEqual(['Admin Ádám', 'Iroda Ildi']);
  });

  it('a belépés is naplózott', async () => {
    await login(ctx.app, IRODA_EMAIL);
    const [last] = await entries(`action=login&userId=${irodaId}`);
    expect(last).toMatchObject({ entityType: 'user', entityId: irodaId, data: { method: 'dev' } });
  });

  it('lapozás a `before` értékkel', async () => {
    const first = (await admin('GET', '/api/audit?limit=2')).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextBefore).toBe(first.items[1].id);
    const second = (await admin('GET', `/api/audit?limit=2&before=${first.nextBefore}`)).json();
    expect(second.items[0].id).toBeLessThan(first.nextBefore);
  });

  it('csak az admin olvassa', async () => {
    expect((await iroda('GET', '/api/audit')).statusCode).toBe(403);
    const terepes = requester(ctx.app, await login(ctx.app, TEREPES_EMAIL));
    expect((await terepes('GET', '/api/audit')).statusCode).toBe(403);
  });

  it('csak hozzáfűzhető', async () => {
    await expect(ctx.pool.query("UPDATE audit_log SET label = 'x'")).rejects.toThrow(/csak hozzáfűzés/);
    await expect(ctx.pool.query('DELETE FROM audit_log')).rejects.toThrow(/csak hozzáfűzés/);
  });
});
