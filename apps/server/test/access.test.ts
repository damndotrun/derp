import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from './helpers.ts';

let ctx: TestContext;
let admin: ReturnType<typeof requester>;
let iroda: ReturnType<typeof requester>;
let terepes: ReturnType<typeof requester>;
let terepesId: string;
let irodaId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  admin = requester(ctx.app, await login(ctx.app));
  iroda = requester(ctx.app, await login(ctx.app, IRODA_EMAIL));
  const tc = await login(ctx.app, TEREPES_EMAIL);
  terepes = requester(ctx.app, tc);
  terepesId = (await terepes('GET', '/api/session')).json().user.id;
  irodaId = (await iroda('GET', '/api/session')).json().user.id;
});
afterAll(() => ctx.close());

const createProject = async (name: string) => (await iroda('POST', '/api/projects', { name })).json() as { id: string; version: number };

describe('szerepkörök a projekteken', () => {
  it('az iroda projektet hoz létre, hozzárendeli a terepest; a terepes csak a hozzá rendeltet látja', async () => {
    const mine = await createProject('Hozzárendelt projekt');
    const other = await createProject('Idegen projekt');
    expect((await iroda('PUT', `/api/projects/${mine.id}/members/${terepesId}`)).statusCode).toBe(204);

    const list = (await terepes('GET', '/api/projects')).json().items.map((p: { id: string }) => p.id);
    expect(list).toContain(mine.id);
    expect(list).not.toContain(other.id);
    // Az iroda mindkettőt látja.
    const all = (await iroda('GET', '/api/projects')).json().items.map((p: { id: string }) => p.id);
    expect(all).toEqual(expect.arrayContaining([mine.id, other.id]));

    expect((await terepes('GET', `/api/projects/${mine.id}`)).statusCode).toBe(200);
    expect((await terepes('GET', `/api/projects/${mine.id}/events`)).statusCode).toBe(200);
    expect((await terepes('GET', `/api/projects/${mine.id}/members`)).json().items).toEqual([
      { id: terepesId, name: 'Terepes Tamás', role: 'terepes' },
    ]);
  });

  it('nem hozzá rendelt projektre a terepes minden projekt-végponton 403-at kap', async () => {
    const other = await createProject('Tiltott projekt');
    for (const [method, url] of [
      ['GET', `/api/projects/${other.id}`],
      ['GET', `/api/projects/${other.id}/events`],
      ['GET', `/api/projects/${other.id}/members`],
      // A minta-modul projekt-végpontja is (ctx.requireProject).
      ['POST', `/api/example/projects/${other.id}/ping`],
    ] as const) {
      const res = await terepes(method, url);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code).toBe('forbidden');
    }
    // Nem létező projektre továbbra is 404.
    expect((await terepes('GET', `/api/projects/${randomUUID()}`)).statusCode).toBe(404);
  });

  it('a terepes nem hoz létre, nem módosít és nem töröl projektet, és nem rendel hozzá kollégát', async () => {
    const p = await createProject('Csak olvasható');
    await iroda('PUT', `/api/projects/${p.id}/members/${terepesId}`);
    expect((await terepes('POST', '/api/projects', { name: 'X' })).statusCode).toBe(403);
    expect((await terepes('PATCH', `/api/projects/${p.id}`, { version: p.version, name: 'Y' })).statusCode).toBe(403);
    expect((await terepes('DELETE', `/api/projects/${p.id}`)).statusCode).toBe(403);
    expect((await terepes('PUT', `/api/projects/${p.id}/members/${irodaId}`)).statusCode).toBe(403);
    expect((await terepes('DELETE', `/api/projects/${p.id}/members/${terepesId}`)).statusCode).toBe(403);
    // A modul saját jogosultsága szerint a hozzá rendelt projekten dolgozhat.
    expect((await terepes('POST', `/api/example/projects/${p.id}/ping`)).statusCode).toBe(201);
  });

  it('hozzárendelés és levétel eseménnyel; az ismételt hozzárendelés nem ír új eseményt', async () => {
    const p = await createProject('Csapat');
    expect((await iroda('PUT', `/api/projects/${p.id}/members/${terepesId}`)).statusCode).toBe(204);
    expect((await iroda('PUT', `/api/projects/${p.id}/members/${terepesId}`)).statusCode).toBe(204);
    expect((await iroda('DELETE', `/api/projects/${p.id}/members/${terepesId}`)).statusCode).toBe(204);
    expect((await iroda('DELETE', `/api/projects/${p.id}/members/${terepesId}`)).statusCode).toBe(404);
    expect((await iroda('PUT', `/api/projects/${p.id}/members/${randomUUID()}`)).statusCode).toBe(400);

    const events = (await iroda('GET', `/api/projects/${p.id}/events`)).json().items;
    expect(events.map((e: { type: string }) => e.type)).toEqual(['core.member_removed', 'core.member_added', 'core.project_created']);
    expect(events[1]).toMatchObject({ title: 'Kolléga hozzárendelve: Terepes Tamás', data: { userId: terepesId }, actor: { name: 'Iroda Ildi' } });
    // Levétel után a terepes már nem látja.
    expect((await terepes('GET', `/api/projects/${p.id}`)).statusCode).toBe(403);
  });

  it('az admin is mindent lát és kezel', async () => {
    const p = await createProject('Admin is');
    expect((await admin('GET', `/api/projects/${p.id}`)).statusCode).toBe(200);
    expect((await admin('PATCH', `/api/projects/${p.id}`, { version: 1, name: 'Admin is (mód.)' })).statusCode).toBe(200);
  });
});
