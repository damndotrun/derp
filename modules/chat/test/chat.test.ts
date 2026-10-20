import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from '../../../apps/server/test/helpers.ts';
import type { ChatMessage, MessagePage, UnreadSummary } from '../shared.ts';

let ctx: TestContext;
let dataDir: string;
let admin: string;
let iroda: string;
let terepes: string;
const ids: Record<'admin' | 'iroda' | 'terepes', string> = { admin: '', iroda: '', terepes: '' };

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'chat-api-'));
  process.env.DATA_DIR = dataDir;
  ctx = await createTestApp({ DERP_MODULES: 'docs,chat' });
  admin = await login(ctx.app);
  iroda = await login(ctx.app, IRODA_EMAIL);
  terepes = await login(ctx.app, TEREPES_EMAIL);
  const users = (await requester(ctx.app, admin)('GET', '/api/users')).json().items as Array<{ id: string; email: string; role: string }>;
  for (const u of users) if (u.role in ids && u.email.endsWith('@derp.test')) ids[u.role as keyof typeof ids] = u.id;
});
afterAll(async () => {
  await ctx.close();
  delete process.env.DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

const as = (cookie: string) => requester(ctx.app, cookie);

async function project(name: string, members: string[] = []): Promise<string> {
  const p = (await as(admin)('POST', '/api/projects', { name })).json();
  for (const m of members) expect((await as(admin)('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

const post = (cookie: string, projectId: string, body: object, id: string = crypto.randomUUID()) =>
  as(cookie)('PUT', `/api/chat/projects/${projectId}/messages/${id}`, body);

const page = async (cookie: string, projectId: string, q = ''): Promise<MessagePage> =>
  (await as(cookie)('GET', `/api/chat/projects/${projectId}/messages${q}`)).json();

const unread = async (cookie: string): Promise<UnreadSummary> => (await as(cookie)('GET', '/api/chat/unread')).json();
const unreadIn = async (cookie: string, projectId: string) => (await unread(cookie)).projects.find((p) => p.projectId === projectId);

describe('chat: üzenet létrehozása', () => {
  it('idempotens a kliens UUID-jával: újraküldve ugyanaz az üzenet, egy sor és egy esemény', async () => {
    const pid = await project('Chat: idempotencia');
    const id = crypto.randomUUID();
    const first = await post(iroda, pid, { body: '  Holnap 8-kor kezdünk.  ' }, id);
    expect(first.statusCode).toBe(201);
    const msg = first.json() as ChatMessage;
    expect(msg).toMatchObject({ id, projectId: pid, body: 'Holnap 8-kor kezdünk.', author: { name: 'Iroda Ildi' }, mentions: [], attachments: [] });

    const again = await post(iroda, pid, { body: 'Holnap 8-kor kezdünk.' }, id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(msg);

    // Párhuzamos újraküldés sem duplikál.
    const parallel = await Promise.all([1, 2, 3].map(() => post(iroda, pid, { body: 'Holnap 8-kor kezdünk.' }, id)));
    expect(parallel.map((r) => r.statusCode)).toEqual([200, 200, 200]);

    const rows = await ctx.pool.query('SELECT count(*)::int AS n FROM chat_messages WHERE id = $1', [id]);
    expect(rows.rows[0].n).toBe(1);
    const events = (await as(iroda)('GET', `/api/projects/${pid}/events`)).json().items as Array<{ id: string; type: string; title: string; data: Record<string, unknown> }>;
    const posted = events.filter((e) => e.type === 'chat.message_posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ id: msg.eventId, title: 'Chat-üzenet: Holnap 8-kor kezdünk.', data: { messageId: id, body: 'Holnap 8-kor kezdünk.' } });

    const audit = (await as(admin)('GET', '/api/audit?entityType=chat.message')).json().items as Array<{ entityId: string; action: string }>;
    expect(audit.filter((a) => a.entityId === id && a.action === 'create')).toHaveLength(1);
  });

  it('ugyanazzal az azonosítóval más tartalom, más szerző vagy más projekt: 409', async () => {
    const pid = await project('Chat: ütközés', [ids.terepes]);
    const other = await project('Chat: ütközés 2');
    const id = crypto.randomUUID();
    expect((await post(iroda, pid, { body: 'Eredeti' }, id)).statusCode).toBe(201);
    expect((await post(iroda, pid, { body: 'Más szöveg' }, id)).statusCode).toBe(409);
    expect((await post(terepes, pid, { body: 'Eredeti' }, id)).statusCode).toBe(409);
    expect((await post(iroda, other, { body: 'Eredeti' }, id)).statusCode).toBe(409);
  });

  it('üres üzenet 400; csak csatolmánnyal küldhető szöveg nélkül', async () => {
    const pid = await project('Chat: üres');
    expect((await post(iroda, pid, { body: '   ' })).statusCode).toBe(400);
    const res = await post(iroda, pid, { attachments: [{ id: crypto.randomUUID(), name: 'kep.jpg' }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().attachments[0]).toMatchObject({ name: 'kep.jpg', status: 'pending' });
  });
});

describe('chat: @említés', () => {
  it('a megemlített, projektet látó felhasználók az üzenetben és az eseményben; a nem hozzá rendelt terepes nem említhető', async () => {
    const withTamas = await project('Chat: említés', [ids.terepes]);
    const msg = (await post(iroda, withTamas, { body: '@Terepes Tamás nézd meg a gépházat, @admin ádám is.' })).json() as ChatMessage;
    expect(msg.mentions).toEqual([
      { id: ids.terepes, name: 'Terepes Tamás' },
      { id: ids.admin, name: 'Admin Ádám' },
    ]);
    const events = (await as(iroda)('GET', `/api/projects/${withTamas}/events`)).json().items as Array<{ id: string; data: { mentions?: string[] } }>;
    expect(events.find((e) => e.id === msg.eventId)!.data.mentions).toEqual([ids.terepes, ids.admin]);

    const people = (await as(terepes)('GET', `/api/chat/projects/${withTamas}/people`)).json().items as Array<{ name: string }>;
    expect(people.map((p) => p.name)).toEqual(expect.arrayContaining(['Admin Ádám', 'Iroda Ildi', 'Terepes Tamás']));

    const without = await project('Chat: említés nélküle');
    expect((await post(iroda, without, { body: '@Terepes Tamás?' })).json().mentions).toEqual([]);
    const people2 = (await as(iroda)('GET', `/api/chat/projects/${without}/people`)).json().items as Array<{ name: string }>;
    expect(people2.map((p) => p.name)).not.toContain('Terepes Tamás');
  });

  it('az olvasatlan-összesítő külön számolja, ahol megemlítettek', async () => {
    const pid = await project('Chat: említés-számláló', [ids.terepes]);
    await post(iroda, pid, { body: 'Általános infó' });
    await post(iroda, pid, { body: '@Terepes Tamás neked szól' });
    expect(await unreadIn(terepes, pid)).toMatchObject({ unread: 2, mentions: 1 });
  });
});

describe('chat: olvasottság', () => {
  it('olvasatlan a más által írt, még nem olvasott üzenet; az olvasás csak előre léptet; a saját üzenet olvasott', async () => {
    const pid = await project('Chat: olvasottság', [ids.terepes]);
    const m1 = (await post(iroda, pid, { body: 'Első' })).json() as ChatMessage;
    const m2 = (await post(iroda, pid, { body: 'Második' })).json() as ChatMessage;
    expect(await unreadIn(iroda, pid)).toMatchObject({ unread: 0 });
    expect(await unreadIn(terepes, pid)).toMatchObject({ unread: 2 });
    expect((await page(terepes, pid)).lastReadSeq).toBe(0);

    const read = await as(terepes)('PUT', `/api/chat/projects/${pid}/read`, { seq: m1.seq });
    expect(read.json()).toEqual({ lastReadSeq: m1.seq });
    expect(await unreadIn(terepes, pid)).toMatchObject({ unread: 1 });

    // Visszafelé nem lép; a projekt utolsó üzeneténél tovább sem.
    expect((await as(terepes)('PUT', `/api/chat/projects/${pid}/read`, { seq: 0 })).json()).toEqual({ lastReadSeq: m1.seq });
    expect((await as(terepes)('PUT', `/api/chat/projects/${pid}/read`, { seq: m2.seq + 1000 })).json()).toEqual({ lastReadSeq: m2.seq });
    expect(await unreadIn(terepes, pid)).toMatchObject({ unread: 0 });

    // A válasz olvasottnak számít a terepesnél, olvasatlannak Ildinél; Ildi látja, hogy Tamás meddig olvasott.
    const m3 = (await post(terepes, pid, { body: 'Megnéztem.' })).json() as ChatMessage;
    expect(await unreadIn(terepes, pid)).toMatchObject({ unread: 0 });
    expect(await unreadIn(iroda, pid)).toMatchObject({ unread: 1 });
    const p = await page(iroda, pid);
    expect(p.reads).toEqual([expect.objectContaining({ user: { id: ids.terepes, name: 'Terepes Tamás' }, lastReadSeq: m3.seq })]);
  });

  it('az összesítő csak a látható projekteket számolja (terepes), a törölt projektet nem', async () => {
    const hidden = await project('Chat: rejtett');
    await post(iroda, hidden, { body: 'Belső ügy' });
    expect(await unreadIn(terepes, hidden)).toBeUndefined();
    expect(await unreadIn(admin, hidden)).toMatchObject({ unread: 1 });

    const gone = await project('Chat: törölt');
    await post(iroda, gone, { body: 'Hamarosan törlöm' });
    expect((await as(admin)('DELETE', `/api/projects/${gone}`)).statusCode).toBe(204);
    expect(await unreadIn(admin, gone)).toBeUndefined();
  });
});

describe('chat: lapozás és jogosultság', () => {
  it('az üzenetek seq szerint növekvő sorrendben, lapozva', async () => {
    const pid = await project('Chat: lapozás');
    for (let i = 1; i <= 5; i++) await post(iroda, pid, { body: `Üzenet ${i}` });
    const last = await page(iroda, pid, '?limit=2');
    expect(last.items.map((m) => m.body)).toEqual(['Üzenet 4', 'Üzenet 5']);
    const prev = await page(iroda, pid, `?limit=2&before=${last.nextBefore}`);
    expect(prev.items.map((m) => m.body)).toEqual(['Üzenet 2', 'Üzenet 3']);
    const first = await page(iroda, pid, `?limit=2&before=${prev.nextBefore}`);
    expect(first.items.map((m) => m.body)).toEqual(['Üzenet 1']);
    expect(first.nextBefore).toBeNull();
  });

  it('a terepes a nem hozzá rendelt projekt chatjére 403-at kap (olvasás, írás, olvasottság, személyek)', async () => {
    const pid = await project('Chat: tiltott');
    await post(iroda, pid, { body: 'Nem neked' });
    expect((await as(terepes)('GET', `/api/chat/projects/${pid}/messages`)).statusCode).toBe(403);
    expect((await post(terepes, pid, { body: 'Hahó' })).statusCode).toBe(403);
    expect((await as(terepes)('PUT', `/api/chat/projects/${pid}/read`, { seq: 1 })).statusCode).toBe(403);
    expect((await as(terepes)('GET', `/api/chat/projects/${pid}/people`)).statusCode).toBe(403);
    expect((await requester(ctx.app)('GET', `/api/chat/projects/${pid}/messages`)).statusCode).toBe(401);
  });
});

describe('chat: csatolmány a dokumentumtárba', () => {
  const upload = (cookie: string, projectId: string, fileId: string, parentEventId?: string) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/api/docs/projects/${projectId}/files/${fileId}?${new URLSearchParams({ name: 'gephaz.txt', type: 'text/plain', ...(parentEventId ? { parentEventId } : {}) })}`,
      payload: Buffer.from('gépház'),
      headers: { cookie, 'content-type': 'application/octet-stream' },
    });

  it('a csatolmány az üzenet után töltődik fel; az esemény az üzenet alá kerül, az üzenet a kész fájlt mutatja', async () => {
    const pid = await project('Chat: csatolmány', [ids.terepes]);
    const fileId = crypto.randomUUID();
    const msg = (await post(terepes, pid, { body: 'Fotó a gépházról', attachments: [{ id: fileId, name: 'gephaz.txt' }] })).json() as ChatMessage;
    expect(msg.attachments).toEqual([expect.objectContaining({ id: fileId, status: 'pending' })]);

    const up = await upload(terepes, pid, fileId, msg.eventId!);
    expect(up.statusCode).toBe(201);
    const [m] = (await page(iroda, pid)).items;
    expect(m!.attachments).toEqual([expect.objectContaining({ id: fileId, name: 'gephaz.txt', status: 'ready', mime: 'text/plain' })]);

    const events = (await as(iroda)('GET', `/api/projects/${pid}/events`)).json().items as Array<{ type: string; parentId: string | null; data: { fileId?: string } }>;
    expect(events.find((e) => e.type === 'docs.file_uploaded' && e.data.fileId === fileId)!.parentId).toBe(msg.eventId);

    // A dokumentumtárból törölve „törölve” állapotú.
    expect((await as(iroda)('DELETE', `/api/docs/files/${fileId}`)).statusCode).toBe(204);
    expect((await page(iroda, pid)).items[0]!.attachments[0]).toMatchObject({ status: 'deleted' });
  });

  it('másik projekt fájlja nem csatolható', async () => {
    const a = await project('Chat: csatolmány A');
    const b = await project('Chat: csatolmány B');
    const fileId = crypto.randomUUID();
    expect((await upload(iroda, a, fileId)).statusCode).toBe(201);
    expect((await post(iroda, b, { body: 'lopott', attachments: [{ id: fileId, name: 'x.txt' }] })).statusCode).toBe(400);
  });
});

describe('chat: kliens oldali időbélyeg (capturedAt, offline sor)', () => {
  it('az offline írt üzenet ideje a terepi időpont; a sorrend (seq) a szerverre érkezésé marad', async () => {
    const pid = await project('Chat: terepi időpont');
    const at = new Date(Date.now() - 45 * 60_000).toISOString();
    expect((await post(admin, pid, { body: 'Online, most' })).statusCode).toBe(201);
    const offline = await post(iroda, pid, { body: 'Offline írva', capturedAt: at });
    expect(offline.statusCode).toBe(201);
    expect((offline.json() as { createdAt: string }).createdAt).toBe(at);

    const items = (await page(iroda, pid)).items;
    expect(items.map((m) => m.body)).toEqual(['Online, most', 'Offline írva']);
    expect(items[1]!.seq).toBeGreaterThan(items[0]!.seq);
    const evs = (await (await as(iroda)('GET', `/api/projects/${pid}/events`)).json()).items as Array<{ title: string; occurredAt: string }>;
    expect(evs.find((e) => e.title === 'Chat-üzenet: Offline írva')!.occurredAt).toBe(at);
  });

  it('jövőbeli időpont helyett a szerver ideje', async () => {
    const pid = await project('Chat: siető óra');
    const before = Date.now();
    const res = await post(iroda, pid, { body: 'Siető óra', capturedAt: new Date(Date.now() + 86_400_000).toISOString() });
    const t = Date.parse((res.json() as { createdAt: string }).createdAt);
    expect(t).toBeGreaterThanOrEqual(before - 1_000);
    expect(t).toBeLessThanOrEqual(Date.now() + 1_000);
  });
});
