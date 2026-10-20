import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from '../../../apps/server/test/helpers.ts';
import { BlobStore } from '../server/blob-store.ts';

let ctx: TestContext;
let dataDir: string;
let store: BlobStore;
let admin: string;
let iroda: string;
let terepes: string;
let terepesId: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'docs-api-'));
  process.env.DATA_DIR = dataDir;
  store = new BlobStore(dataDir);
  ctx = await createTestApp({ DERP_MODULES: 'docs' });
  admin = await login(ctx.app);
  iroda = await login(ctx.app, IRODA_EMAIL);
  terepes = await login(ctx.app, TEREPES_EMAIL);
  const users = (await requester(ctx.app, admin)('GET', '/api/users')).json().items as Array<{ id: string; email: string }>;
  terepesId = users.find((u) => u.email === TEREPES_EMAIL)!.id;
});
afterAll(async () => {
  await ctx.close();
  delete process.env.DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const as = (cookie: string) => requester(ctx.app, cookie);

async function project(name: string, members: string[] = []): Promise<string> {
  const p = (await as(admin)('POST', '/api/projects', { name })).json();
  for (const m of members) expect((await as(admin)('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

function upload(
  cookie: string,
  projectId: string,
  body: Buffer,
  query: Record<string, string> = {},
  id: string = crypto.randomUUID(),
) {
  const qs = new URLSearchParams({ name: 'fajl.bin', ...query });
  return ctx.app.inject({
    method: 'PUT',
    url: `/api/docs/projects/${projectId}/files/${id}?${qs}`,
    payload: body,
    headers: { cookie, 'content-type': 'application/octet-stream' },
  });
}

const photo = (r: number, g = 80, b = 120) =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();

const blobCount = async (h: string) =>
  Number((await ctx.pool.query('SELECT count(*) FROM docs_blobs WHERE sha256 = $1', [h])).rows[0].count);

describe('docs modul: feltöltés', () => {
  it('fotó feltöltése: tartalom szerinti tárolás, bélyegkép, esemény az idővonalra, auditnapló', async () => {
    const pid = await project('Docs: feltöltés');
    const img = await photo(10);
    const res = await upload(admin, pid, img, { name: 'Gépház.jpg', type: 'image/jpeg', sha256: sha(img) });
    expect(res.statusCode).toBe(201);
    const file = res.json();
    expect(file).toMatchObject({ projectId: pid, name: 'Gépház.jpg', mime: 'image/jpeg', size: img.length, sha256: sha(img), hasThumb: true });
    expect(file.uploadedBy.name).toBe('Admin Ádám');

    // hash-útvonal a DATA_DIR alatt
    expect((await stat(path.join(dataDir, 'blobs', sha(img).slice(0, 2), sha(img).slice(2, 4), sha(img)))).size).toBe(img.length);
    const thumb = await ctx.app.inject({ method: 'GET', url: `/api/docs/files/${file.id}/thumb`, headers: { cookie: admin } });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    const meta = await sharp(thumb.rawPayload).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(400);

    const events = (await as(admin)('GET', `/api/projects/${pid}/events`)).json().items;
    expect(events[0]).toMatchObject({
      id: file.eventId,
      type: 'docs.file_uploaded',
      title: 'Fotó feltöltve: Gépház.jpg',
      data: { fileId: file.id, name: 'Gépház.jpg', mime: 'image/jpeg', thumb: true, folderId: null },
    });

    const list = (await as(admin)('GET', `/api/docs/projects/${pid}`)).json();
    expect(list.files.map((f: { id: string }) => f.id)).toEqual([file.id]);

    const audit = (await as(admin)('GET', `/api/audit?entityType=docs.file`)).json().items as Array<{ entityId: string; action: string }>;
    expect(audit.some((a) => a.entityId === file.id && a.action === 'create')).toBe(true);
  });

  it('a letöltés a tartalmat adja, előnézethez inline, ?download=1-re csatolmányként; a megnyitás az auditnaplóba kerül', async () => {
    const pid = await project('Docs: letöltés');
    const body = Buffer.from('%PDF-1.4 próba');
    const file = (await upload(iroda, pid, body, { name: 'Árlista.pdf', type: 'application/pdf' })).json();
    const get = (q = '') => ctx.app.inject({ method: 'GET', url: `/api/docs/files/${file.id}/content${q}`, headers: { cookie: iroda } });
    const inline = await get();
    expect(inline.statusCode).toBe(200);
    expect(inline.rawPayload).toEqual(body);
    expect(inline.headers['content-type']).toBe('application/pdf');
    expect(inline.headers['content-disposition']).toMatch(/^inline; filename="Arlista.pdf"; filename\*=UTF-8''%C3%81rlista.pdf$/);
    expect((await get('?download=1')).headers['content-disposition']).toMatch(/^attachment;/);

    const etag = inline.headers.etag as string;
    const cached = await ctx.app.inject({ method: 'GET', url: `/api/docs/files/${file.id}/content`, headers: { cookie: iroda, 'if-none-match': etag } });
    expect(cached.statusCode).toBe(304);

    const audit = (await as(admin)('GET', `/api/audit?entityType=docs.file&action=view`)).json().items as Array<{ entityId: string }>;
    expect(audit.some((a) => a.entityId === file.id)).toBe(true);
  });

  it('nem böngészőbe való típus (pl. HTML) mindig letöltésként, szkript nélkül megy ki', async () => {
    const pid = await project('Docs: html');
    const file = (await upload(admin, pid, Buffer.from('<script>alert(1)</script>'), { name: 'x.html', type: 'text/html' })).json();
    const res = await ctx.app.inject({ method: 'GET', url: `/api/docs/files/${file.id}/content`, headers: { cookie: admin } });
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('ugyanazzal az azonosítóval kétszer küldve egy fájl és egy esemény; más tartalommal 409', async () => {
    const pid = await project('Docs: idempotencia');
    const id = crypto.randomUUID();
    const body = Buffer.from('offline sorból újraküldve');
    expect((await upload(admin, pid, body, {}, id)).statusCode).toBe(201);
    const again = await upload(admin, pid, body, {}, id);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(id);
    expect((await upload(admin, pid, Buffer.from('más tartalom'), {}, id)).statusCode).toBe(409);
    const events = (await as(admin)('GET', `/api/projects/${pid}/events`)).json().items as Array<{ type: string }>;
    expect(events.filter((e) => e.type === 'docs.file_uploaded')).toHaveLength(1);
  });

  it('sérült feltöltés (eltérő sha256) 400, és nem marad utána fájl', async () => {
    const pid = await project('Docs: sérült');
    const body = Buffer.from('ez jött meg');
    const res = await upload(admin, pid, body, { sha256: sha(Buffer.from('ezt küldtük')) });
    expect(res.statusCode).toBe(400);
    expect(await blobCount(sha(body))).toBe(0);
    expect(await readdir(path.join(dataDir, 'tmp'))).toEqual([]);
  });

  it('üres fájl is feltölthető', async () => {
    const pid = await project('Docs: üres');
    const res = await upload(admin, pid, Buffer.alloc(0), { name: 'ures.txt' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ size: 0, mime: 'text/plain', hasThumb: false });
  });
});

describe('docs modul: duplikáció és blob-hivatkozásszámlálás', () => {
  it('azonos tartalom két fájlként (két projektben is) egy blobra hivatkozik', async () => {
    const p1 = await project('Docs: duplikáció 1');
    const p2 = await project('Docs: duplikáció 2');
    const img = await photo(20);
    const a = (await upload(admin, p1, img, { name: 'a.jpg' })).json();
    const b = (await upload(admin, p1, img, { name: 'b.jpg' })).json();
    const c = (await upload(admin, p2, img, { name: 'c.jpg' })).json();
    expect(new Set([a.sha256, b.sha256, c.sha256]).size).toBe(1);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(await blobCount(sha(img))).toBe(1);
    expect(await readdir(path.dirname(store.blobPath(sha(img))))).toEqual([sha(img)]);
    // A másodiknál is van bélyegkép (a blobé).
    expect(b.hasThumb).toBe(true);
  });

  it('a blob csak az utolsó hivatkozás törlése után törlődik (sor, fájl és bélyegkép)', async () => {
    const pid = await project('Docs: törlés');
    const img = await photo(30);
    const h = sha(img);
    const a = (await upload(admin, pid, img, { name: 'első.jpg' })).json();
    const b = (await upload(admin, pid, img, { name: 'második.jpg' })).json();

    expect((await as(admin)('DELETE', `/api/docs/files/${a.id}`)).statusCode).toBe(204);
    expect(await blobCount(h)).toBe(1);
    expect(await store.exists(h)).toBe(true);
    const still = await ctx.app.inject({ method: 'GET', url: `/api/docs/files/${b.id}/content`, headers: { cookie: admin } });
    expect(still.rawPayload).toEqual(img);
    expect((await as(admin)('GET', `/api/docs/files/${a.id}`)).statusCode).toBe(404);

    expect((await as(admin)('DELETE', `/api/docs/files/${b.id}`)).statusCode).toBe(204);
    expect(await blobCount(h)).toBe(0);
    expect(await store.exists(h)).toBe(false);
    await expect(stat(store.thumbPath(h))).rejects.toThrow();
    expect(await readdir(path.join(dataDir, 'trash'))).toEqual([]);

    const events = (await as(admin)('GET', `/api/projects/${pid}/events`)).json().items as Array<{ type: string; title: string }>;
    expect(events.filter((e) => e.type === 'docs.file_deleted').map((e) => e.title).sort()).toEqual([
      'Fotó törölve: első.jpg',
      'Fotó törölve: második.jpg',
    ]);
  });

  it('a törölt blob tartalma újra feltölthető', async () => {
    const pid = await project('Docs: újrafeltöltés');
    const body = Buffer.from('visszatér');
    const a = (await upload(admin, pid, body)).json();
    await as(admin)('DELETE', `/api/docs/files/${a.id}`);
    const b = await upload(admin, pid, body);
    expect(b.statusCode).toBe(201);
    expect(await store.exists(sha(body))).toBe(true);
  });

  it('párhuzamos törlés és feltöltés ugyanarra a blobra: a lemezen marad a fájl', async () => {
    const pid = await project('Docs: verseny');
    const body = Buffer.from('versenyhelyzet');
    for (let i = 0; i < 5; i++) {
      const a = (await upload(admin, pid, body)).json();
      const [del, up] = await Promise.all([as(admin)('DELETE', `/api/docs/files/${a.id}`), upload(admin, pid, body)]);
      expect(del.statusCode).toBe(204);
      expect(up.statusCode).toBe(201);
      expect(await store.exists(sha(body))).toBe(true);
      expect(await blobCount(sha(body))).toBe(1);
      await as(admin)('DELETE', `/api/docs/files/${up.json().id}`);
      expect(await store.exists(sha(body))).toBe(false);
    }
  });
});

describe('docs modul: mappák', () => {
  it('mappa létrehozása, fájl a mappába, áthelyezés, átnevezés verzióval, csak üres mappa törölhető', async () => {
    const pid = await project('Docs: mappák');
    const folder = await as(admin)('POST', `/api/docs/projects/${pid}/folders`, { name: 'Fotók' });
    expect(folder.statusCode).toBe(201);
    const fid = folder.json().id;
    expect((await as(admin)('POST', `/api/docs/projects/${pid}/folders`, { name: 'fotók' })).statusCode).toBe(409);
    const sub = (await as(admin)('POST', `/api/docs/projects/${pid}/folders`, { name: 'Gépház', parentId: fid })).json();
    expect(sub.parentId).toBe(fid);

    const file = (await upload(admin, pid, Buffer.from('x'), { name: 'a.txt', folderId: fid })).json();
    expect(file.folderId).toBe(fid);
    expect((await as(admin)('DELETE', `/api/docs/folders/${fid}`)).statusCode).toBe(409);

    const moved = await as(admin)('PATCH', `/api/docs/files/${file.id}`, { version: 1, folderId: null, name: 'b.txt' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ folderId: null, name: 'b.txt', version: 2 });
    expect((await as(admin)('PATCH', `/api/docs/files/${file.id}`, { version: 1, name: 'c.txt' })).statusCode).toBe(409);

    const renamed = await as(admin)('PATCH', `/api/docs/folders/${fid}`, { version: 1, name: 'Helyszíni fotók' });
    expect(renamed.json()).toMatchObject({ name: 'Helyszíni fotók', version: 2 });
    expect((await as(admin)('DELETE', `/api/docs/folders/${fid}`)).statusCode).toBe(409);
    expect((await as(admin)('DELETE', `/api/docs/folders/${sub.id}`)).statusCode).toBe(204);
    expect((await as(admin)('DELETE', `/api/docs/folders/${fid}`)).statusCode).toBe(204);
  });

  it('más projekt mappájába nem lehet feltölteni, és nem lehet oda áthelyezni', async () => {
    const p1 = await project('Docs: idegen mappa 1');
    const p2 = await project('Docs: idegen mappa 2');
    const other = (await as(admin)('POST', `/api/docs/projects/${p2}/folders`, { name: 'Idegen' })).json();
    expect((await upload(admin, p1, Buffer.from('x'), { folderId: other.id })).statusCode).toBe(400);
    const file = (await upload(admin, p1, Buffer.from('y'))).json();
    expect((await as(admin)('PATCH', `/api/docs/files/${file.id}`, { version: 1, folderId: other.id })).statusCode).toBe(400);
  });

  it('a szülő-esemény csak ugyanabból a projektből lehet; az esemény a szülőjéhez kötve kerül az idővonalra', async () => {
    const p1 = await project('Docs: szülő 1');
    const p2 = await project('Docs: szülő 2');
    const parent = (await as(admin)('GET', `/api/projects/${p1}/events`)).json().items[0].id as string;
    expect((await upload(admin, p2, Buffer.from('x'), { parentEventId: parent })).statusCode).toBe(400);
    const file = (await upload(admin, p1, Buffer.from('z'), { parentEventId: parent })).json();
    const events = (await as(admin)('GET', `/api/projects/${p1}/events`)).json().items as Array<{ id: string; parentId: string | null }>;
    expect(events.find((e) => e.id === file.eventId)?.parentId).toBe(parent);
  });
});

describe('docs modul: jogosultság', () => {
  it('a terepes nem látja a nem hozzá rendelt projekt fájljait (lista, adat, tartalom, bélyegkép: 403)', async () => {
    const pid = await project('Docs: idegen projekt');
    const file = (await upload(admin, pid, await photo(40), { name: 'titkos.jpg' })).json();
    const t = as(terepes);
    expect((await t('GET', `/api/docs/projects/${pid}`)).statusCode).toBe(403);
    expect((await t('GET', `/api/docs/files/${file.id}`)).statusCode).toBe(403);
    expect((await t('GET', `/api/docs/files/${file.id}/content`)).statusCode).toBe(403);
    expect((await t('GET', `/api/docs/files/${file.id}/thumb`)).statusCode).toBe(403);
    expect((await t('DELETE', `/api/docs/files/${file.id}`)).statusCode).toBe(403);
    expect((await upload(terepes, pid, Buffer.from('x'))).statusCode).toBe(403);
    expect((await t('POST', `/api/docs/projects/${pid}/folders`, { name: 'x' })).statusCode).toBe(403);
  });

  it('a terepes a hozzá rendelt projektbe feltölthet, a sajátját törölheti, a másét nem', async () => {
    const pid = await project('Docs: Tamás projektje', [terepesId]);
    const own = await upload(terepes, pid, Buffer.from('saját'), { name: 'sajat.txt' });
    expect(own.statusCode).toBe(201);
    const others = (await upload(iroda, pid, Buffer.from('irodai'), { name: 'irodai.txt' })).json();
    const t = as(terepes);
    expect((await t('GET', `/api/docs/projects/${pid}`)).json().files).toHaveLength(2);
    expect((await t('DELETE', `/api/docs/files/${others.id}`)).statusCode).toBe(403);
    expect((await t('PATCH', `/api/docs/files/${others.id}`, { version: 1, name: 'átnevezve.txt' })).statusCode).toBe(403);
    expect((await t('DELETE', `/api/docs/files/${own.json().id}`)).statusCode).toBe(204);
    // Mappát létrehozhat, de törölni csak az iroda tud.
    const folder = (await t('POST', `/api/docs/projects/${pid}/folders`, { name: 'Terep' })).json();
    expect((await t('DELETE', `/api/docs/folders/${folder.id}`)).statusCode).toBe(403);
    expect((await as(iroda)('DELETE', `/api/docs/folders/${folder.id}`)).statusCode).toBe(204);
    // Az iroda bárkiét törölheti.
    expect((await as(iroda)('DELETE', `/api/docs/files/${others.id}`)).statusCode).toBe(204);
  });

  it('belépés nélkül 401, ismeretlen fájlra és projektre 404', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: `/api/docs/files/${crypto.randomUUID()}` })).statusCode).toBe(401);
    expect((await as(admin)('GET', `/api/docs/files/${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect((await as(admin)('GET', `/api/docs/projects/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });
});
