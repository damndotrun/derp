import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from './helpers.ts';

let ctx: TestContext;
let iroda: ReturnType<typeof requester>;
let terepes: ReturnType<typeof requester>;
let terepesId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  iroda = requester(ctx.app, await login(ctx.app, IRODA_EMAIL));
  terepes = requester(ctx.app, await login(ctx.app, TEREPES_EMAIL));
  terepesId = (await terepes('GET', '/api/session')).json().user.id;
});
afterAll(() => ctx.close());

describe('ügyfelek és kapcsolattartók', () => {
  it('ügyfél + kapcsolattartó felvétele, a részletek a kapcsolattartókkal', async () => {
    const created = await iroda('POST', '/api/clients', { name: '  Minta Kft. ', address: 'Kecskemét, Fő u. 1.' });
    expect(created.statusCode).toBe(201);
    const client = created.json();
    expect(client).toMatchObject({ name: 'Minta Kft.', address: 'Kecskemét, Fő u. 1.', note: '', version: 1 });

    const contact = await iroda('POST', `/api/clients/${client.id}/contacts`, {
      name: 'Kovács Béla',
      position: 'műszaki vezető',
      phone: '+36 30 123 4567',
      email: 'bela@minta.hu',
    });
    expect(contact.statusCode).toBe(201);

    const detail = (await iroda('GET', `/api/clients/${client.id}`)).json();
    expect(detail.contacts).toEqual([
      expect.objectContaining({ name: 'Kovács Béla', position: 'műszaki vezető', phone: '+36 30 123 4567', email: 'bela@minta.hu' }),
    ]);
    expect((await iroda('GET', '/api/clients')).json().items.map((c: { id: string }) => c.id)).toContain(client.id);
  });

  it('hibás e-mail-címre 400, ismeretlen ügyfélre 404', async () => {
    const client = (await iroda('POST', '/api/clients', { name: 'Hibás Bt.' })).json();
    expect((await iroda('POST', `/api/clients/${client.id}/contacts`, { name: 'X', email: 'nem-email' })).statusCode).toBe(400);
    expect((await iroda('POST', `/api/clients/${randomUUID()}/contacts`, { name: 'X' })).statusCode).toBe(404);
    expect((await iroda('GET', `/api/clients/${randomUUID()}`)).statusCode).toBe(404);
  });

  it('módosítás verzióval (eltérésnél 409), törlés rejtéssel', async () => {
    const client = (await iroda('POST', '/api/clients', { name: 'Régi Kft.' })).json();
    const ok = await iroda('PATCH', `/api/clients/${client.id}`, { version: 1, name: 'Új Kft.' });
    expect(ok.json()).toMatchObject({ name: 'Új Kft.', version: 2 });
    expect((await iroda('PATCH', `/api/clients/${client.id}`, { version: 1, name: 'Ütköző' })).statusCode).toBe(409);

    const contact = (await iroda('POST', `/api/clients/${client.id}/contacts`, { name: 'Nagy Anna' })).json();
    expect((await iroda('PATCH', `/api/contacts/${contact.id}`, { version: 1, phone: '06 1 234 5678' })).json()).toMatchObject({
      phone: '06 1 234 5678',
      version: 2,
    });
    expect((await iroda('PATCH', `/api/contacts/${contact.id}`, { version: 1, phone: 'x' })).statusCode).toBe(409);
    expect((await iroda('DELETE', `/api/contacts/${contact.id}`)).statusCode).toBe(204);
    expect((await iroda('GET', `/api/clients/${client.id}`)).json().contacts).toEqual([]);

    expect((await iroda('DELETE', `/api/clients/${client.id}`)).statusCode).toBe(204);
    expect((await iroda('GET', `/api/clients/${client.id}`)).statusCode).toBe(404);
    // Törölt ügyfél új projekthez nem rendelhető.
    expect((await iroda('POST', '/api/projects', { name: 'P', clientId: client.id })).statusCode).toBe(400);
  });

  it('a projekt ügyfele módosítható, a változás az eseménybe kerül', async () => {
    const a = (await iroda('POST', '/api/clients', { name: 'Első Kft.' })).json();
    const b = (await iroda('POST', '/api/clients', { name: 'Második Kft.' })).json();
    const p = (await iroda('POST', '/api/projects', { name: 'Ügyfélcsere', clientId: a.id })).json();
    const res = await iroda('PATCH', `/api/projects/${p.id}`, { version: 1, clientId: b.id });
    expect(res.json()).toMatchObject({ client: { id: b.id, name: 'Második Kft.' }, version: 2 });
    const [updated] = (await iroda('GET', `/api/projects/${p.id}/events`)).json().items;
    expect(updated.data).toEqual({ changes: { client: { from: 'Első Kft.', to: 'Második Kft.' } } });
    expect((await iroda('GET', `/api/projects?clientId=${b.id}`)).json().items.map((x: { id: string }) => x.id)).toEqual([p.id]);
  });

  it('a terepes csak a hozzá rendelt projektek ügyfeleit (és elérhetőségüket) látja, és nem szerkeszti őket', async () => {
    const seen = (await iroda('POST', '/api/clients', { name: 'Látható Kft.' })).json();
    const hidden = (await iroda('POST', '/api/clients', { name: 'Rejtett Kft.' })).json();
    await iroda('POST', `/api/clients/${seen.id}/contacts`, { name: 'Szabó Éva', phone: '+36 20 111 2222' });
    const p = (await iroda('POST', '/api/projects', { name: 'Terepi munka', clientId: seen.id })).json();
    await iroda('POST', '/api/projects', { name: 'Más munka', clientId: hidden.id });
    await iroda('PUT', `/api/projects/${p.id}/members/${terepesId}`);

    const detail = await terepes('GET', `/api/clients/${seen.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().contacts[0]).toMatchObject({ name: 'Szabó Éva', phone: '+36 20 111 2222' });
    expect((await terepes('GET', `/api/clients/${hidden.id}`)).statusCode).toBe(403);
    const list = (await terepes('GET', '/api/clients')).json().items.map((c: { id: string }) => c.id);
    expect(list).toContain(seen.id);
    expect(list).not.toContain(hidden.id);

    expect((await terepes('POST', '/api/clients', { name: 'X' })).statusCode).toBe(403);
    expect((await terepes('PATCH', `/api/clients/${seen.id}`, { version: 1, name: 'X' })).statusCode).toBe(403);
    expect((await terepes('POST', `/api/clients/${seen.id}/contacts`, { name: 'X' })).statusCode).toBe(403);
  });
});
