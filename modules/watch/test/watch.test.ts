import { mkdir, mkdtemp, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from '../../../apps/server/test/helpers.ts';
import { eventTime } from '../server/scanner.ts';
import { isIgnored, watchIntervalSec, watchRoot } from '../server/fs.ts';

let ctx: TestContext;
let root: string;
let admin: string;
let iroda: string;
let terepes: string;
let terepesId: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'watch-api-'));
  process.env.WATCH_ROOT = root;
  process.env.WATCH_INTERVAL_SEC = '0';
  ctx = await createTestApp({ DERP_MODULES: 'watch' });
  admin = await login(ctx.app);
  iroda = await login(ctx.app, IRODA_EMAIL);
  terepes = await login(ctx.app, TEREPES_EMAIL);
  const users = (await requester(ctx.app, admin)('GET', '/api/users')).json().items as Array<{ id: string; email: string }>;
  terepesId = users.find((u) => u.email === TEREPES_EMAIL)!.id;
});
afterAll(async () => {
  await ctx.close();
  delete process.env.WATCH_ROOT;
  delete process.env.WATCH_INTERVAL_SEC;
  await rm(root, { recursive: true, force: true });
});

const as = (cookie: string) => requester(ctx.app, cookie);

async function project(name: string, members: string[] = []): Promise<string> {
  const p = (await as(admin)('POST', '/api/projects', { name })).json();
  for (const m of members) expect((await as(admin)('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

/** Fájl a figyelt gyökér alatt; az mtime másodpercekben (alapból a fájlrendszeré). */
async function put(rel: string, content: string | Buffer, mtimeSec?: number) {
  const abs = path.join(root, ...rel.split('/'));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  if (mtimeSec !== undefined) await utimes(abs, mtimeSec, mtimeSec);
}
const abs = (rel: string) => path.join(root, ...rel.split('/'));

const assign = (cookie: string, pid: string, folder: string, version?: number) =>
  as(cookie)('PUT', `/api/watch/projects/${pid}/mapping`, { path: folder, ...(version ? { version } : {}) });
const scan = (cookie: string, pid: string) => as(cookie)('POST', `/api/watch/projects/${pid}/scan`);
const watchEvents = async (pid: string) =>
  ((await as(admin)('GET', `/api/projects/${pid}/events?types=watch.file_added,watch.file_modified,watch.file_deleted,watch.file_renamed`)).json()
    .items as Array<{ type: string; title: string; occurredAt: string; data: Record<string, unknown>; source: string; actor: unknown }>);
const files = async (pid: string) =>
  ((await as(admin)('GET', `/api/watch/projects/${pid}`)).json().files as Array<{ id: string; path: string; size: number }>);

describe('watch modul: bejárás ideiglenes könyvtárral', () => {
  it('hozzárendeléskor a meglévő fájlok esemény nélkül kerülnek be; utána létrehoz, módosít, töröl, átnevez → helyes események', async () => {
    const pid = await project('Watch: események');
    await put('Projektek/Esemenyek/meglevo.txt', 'régi');
    await put('Projektek/Esemenyek/Rajzok/alaprajz.dwg', 'rajz');

    const res = await assign(iroda, pid, 'Projektek/Esemenyek/');
    expect(res.statusCode).toBe(200);
    expect(res.json().mapping).toMatchObject({ projectId: pid, path: 'Projektek/Esemenyek', version: 1, lastError: null, fileCount: 2 });
    expect(res.json().mapping.lastScanAt).not.toBeNull();
    expect(res.json().files.map((f: { path: string }) => f.path)).toEqual(['Rajzok/alaprajz.dwg', 'meglevo.txt']);
    expect(await watchEvents(pid)).toEqual([]);

    // Nincs változás → nincs esemény.
    expect((await scan(iroda, pid)).json()).toEqual({ added: 0, modified: 0, deleted: 0, renamed: 0, files: 2, error: null });

    // Létrehoz
    await put('Projektek/Esemenyek/Árlisták/árlista_beszállító.pdf', '%PDF-1.4 árlista');
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 1, modified: 0, deleted: 0, renamed: 0, files: 3 });
    let events = await watchEvents(pid);
    expect(events).toHaveLength(1);
    const added = events[0]!;
    expect(added).toMatchObject({
      type: 'watch.file_added',
      title: 'Új fájl a szerveren: árlista_beszállító.pdf',
      source: 'filesystem',
      actor: null,
      data: { path: 'Árlisták/árlista_beszállító.pdf', name: 'árlista_beszállító.pdf', size: Buffer.byteLength('%PDF-1.4 árlista') },
    });
    const fileId = added.data.fileId as string;

    // Módosít (más tartalom)
    await put('Projektek/Esemenyek/Árlisták/árlista_beszállító.pdf', '%PDF-1.4 új árlista, több tétellel');
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 0, modified: 1, deleted: 0, renamed: 0 });
    events = await watchEvents(pid);
    expect(events[0]).toMatchObject({
      type: 'watch.file_modified',
      title: 'Fájl módosult a szerveren: árlista_beszállító.pdf',
      data: { fileId, size: Buffer.byteLength('%PDF-1.4 új árlista, több tétellel') },
    });

    // Csak az mtime változik, a tartalom nem → nincs esemény.
    await utimes(abs('Projektek/Esemenyek/meglevo.txt'), 1_700_000_000, 1_700_000_000);
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 0, modified: 0, deleted: 0, renamed: 0 });

    // Átnevez (ugyanaz a tartalom) → egy „átnevezve” esemény, a fájl azonosítója megmarad.
    await rename(abs('Projektek/Esemenyek/Árlisták/árlista_beszállító.pdf'), abs('Projektek/Esemenyek/Árlisták/arlista_2026.pdf'));
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 0, modified: 0, deleted: 0, renamed: 1, files: 3 });
    events = await watchEvents(pid);
    expect(events[0]).toMatchObject({
      type: 'watch.file_renamed',
      title: 'Fájl átnevezve a szerveren: árlista_beszállító.pdf → arlista_2026.pdf',
      data: { fileId, path: 'Árlisták/arlista_2026.pdf', oldPath: 'Árlisták/árlista_beszállító.pdf' },
    });

    // Áthelyezés másik almappába, ugyanazzal a névvel: a címben a teljes útvonalak.
    await mkdir(abs('Projektek/Esemenyek/Archív'));
    await rename(abs('Projektek/Esemenyek/Árlisták/arlista_2026.pdf'), abs('Projektek/Esemenyek/Archív/arlista_2026.pdf'));
    expect((await scan(iroda, pid)).json()).toMatchObject({ renamed: 1 });
    expect((await watchEvents(pid))[0]).toMatchObject({
      type: 'watch.file_renamed',
      title: 'Fájl átnevezve a szerveren: Árlisták/arlista_2026.pdf → Archív/arlista_2026.pdf',
      data: { fileId },
    });

    // Töröl
    await rm(abs('Projektek/Esemenyek/Rajzok/alaprajz.dwg'));
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 0, modified: 0, deleted: 1, renamed: 0, files: 2 });
    events = await watchEvents(pid);
    expect(events[0]).toMatchObject({ type: 'watch.file_deleted', title: 'Fájl törölve a szerverről: alaprajz.dwg', data: { path: 'Rajzok/alaprajz.dwg' } });
    expect((await files(pid)).map((f) => f.path)).toEqual(['Archív/arlista_2026.pdf', 'meglevo.txt']);
    expect(events.map((e) => e.type)).toEqual([
      'watch.file_deleted',
      'watch.file_renamed',
      'watch.file_renamed',
      'watch.file_modified',
      'watch.file_added',
    ]);
  });

  it('átnevezés tartalomváltozással = törlés + új; azonos tartalmú másolat = új fájl, az eredeti marad', async () => {
    const pid = await project('Watch: átnevezés és másolat');
    await put('Projektek/Atnevezes/a.txt', 'egy');
    await assign(iroda, pid, 'Projektek/Atnevezes');

    await rm(abs('Projektek/Atnevezes/a.txt'));
    await put('Projektek/Atnevezes/b.txt', 'kettő');
    await put('Projektek/Atnevezes/c.txt', 'kettő');
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 2, deleted: 1, renamed: 0 });
    const types = (await watchEvents(pid)).map((e) => `${e.type} ${e.data.path}`).sort();
    expect(types).toEqual(['watch.file_added b.txt', 'watch.file_added c.txt', 'watch.file_deleted a.txt']);
  });

  it('új fájl eseményének ideje: a módosítási idő, ha az előző bejárás után van; régi dátummal másolt fájlnál az észlelés ideje', async () => {
    const pid = await project('Watch: időpont');
    await mkdir(abs('Projektek/Idopont'), { recursive: true });
    await assign(iroda, pid, 'Projektek/Idopont');
    const before = Date.now();
    await put('Projektek/Idopont/regi.pdf', 'régi dátummal másolva', Date.UTC(2019, 4, 1) / 1000);
    await put('Projektek/Idopont/friss.pdf', 'most készült');
    await scan(iroda, pid);
    const byName = new Map((await watchEvents(pid)).map((e) => [e.data.name, e]));
    expect(new Date(byName.get('regi.pdf')!.occurredAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(byName.get('regi.pdf')!.data.mtime).toBe('2019-05-01T00:00:00.000Z');
    expect(byName.get('friss.pdf')!.occurredAt).toBe(byName.get('friss.pdf')!.data.mtime);

    const t = (iso: string) => new Date(iso);
    expect(eventTime(t('2026-10-20T10:00:00Z'), t('2026-10-20T09:55:00Z'), t('2026-10-20T10:01:00Z'))).toEqual(t('2026-10-20T10:00:00Z'));
    expect(eventTime(t('2026-10-20T09:00:00Z'), t('2026-10-20T09:55:00Z'), t('2026-10-20T10:01:00Z'))).toEqual(t('2026-10-20T10:01:00Z'));
    expect(eventTime(t('2026-10-20T11:00:00Z'), t('2026-10-20T09:55:00Z'), t('2026-10-20T10:01:00Z'))).toEqual(t('2026-10-20T10:01:00Z'));
    expect(eventTime(t('2026-10-20T10:00:00Z'), null, t('2026-10-20T10:01:00Z'))).toEqual(t('2026-10-20T10:01:00Z'));
  });

  it('rendszer- és ideiglenes fájlok, rejtett mappák és a gyökéren kívülre mutató linkek kimaradnak', async () => {
    const pid = await project('Watch: kihagyott');
    const outside = await mkdtemp(path.join(tmpdir(), 'watch-outside-'));
    await writeFile(path.join(outside, 'titok.txt'), 'titok');
    await put('Projektek/Kihagyott/rendes.docx', 'x');
    for (const f of ['.DS_Store', '~$rendes.docx', '~WRL0001.tmp', 'Thumbs.db', 'desktop.ini', '@eaDir/kep.jpg', '#recycle/torolt.pdf', '.rejtett/a.txt']) {
      await put(`Projektek/Kihagyott/${f}`, 'x');
    }
    await symlink(outside, abs('Projektek/Kihagyott/kifele'));
    await symlink(path.join(outside, 'titok.txt'), abs('Projektek/Kihagyott/titok.txt'));
    await assign(iroda, pid, 'Projektek/Kihagyott');
    expect((await files(pid)).map((f) => f.path)).toEqual(['rendes.docx']);
    expect(isIgnored('Árlista.pdf')).toBe(false);
    await rm(outside, { recursive: true, force: true });
  });

  it('ha a mappa nem érhető el, nincs törlés-esemény, csak a hiba; visszaállás után folytatódik', async () => {
    const pid = await project('Watch: elérhetetlen');
    await put('Projektek/Eltuno/a.txt', 'a');
    await put('Projektek/Eltuno/b.txt', 'b');
    await assign(iroda, pid, 'Projektek/Eltuno');

    await rename(abs('Projektek/Eltuno'), abs('Projektek/Eltuno-masolas-alatt'));
    const res = (await scan(iroda, pid)).json();
    expect(res).toMatchObject({ added: 0, deleted: 0, error: 'A mappa nem található: Projektek/Eltuno' });
    expect(await watchEvents(pid)).toEqual([]);
    const state = (await as(iroda)('GET', `/api/watch/projects/${pid}`)).json();
    expect(state.mapping.lastError).toBe('A mappa nem található: Projektek/Eltuno');
    expect(state.files).toHaveLength(2);

    await rename(abs('Projektek/Eltuno-masolas-alatt'), abs('Projektek/Eltuno'));
    await rm(abs('Projektek/Eltuno/b.txt'));
    expect((await scan(iroda, pid)).json()).toMatchObject({ deleted: 1, error: null });
    expect((await as(iroda)('GET', `/api/watch/projects/${pid}`)).json().mapping.lastError).toBeNull();
  });

  // Rootként minden könyvtár olvasható, ott ez a teszt kimarad.
  it.skipIf(process.getuid?.() === 0)('olvashatatlan almappa: a bejárás hibát ad, a fájljai nem látszanak töröltnek', async () => {
    const { chmod } = await import('node:fs/promises');
    const pid = await project('Watch: olvashatatlan');
    await put('Projektek/Zart/Belso/a.txt', 'a');
    await assign(iroda, pid, 'Projektek/Zart');
    await chmod(abs('Projektek/Zart/Belso'), 0o000);
    try {
      expect((await scan(iroda, pid)).json().error).toMatch(/nem olvasható: Belso/);
      expect(await watchEvents(pid)).toEqual([]);
    } finally {
      await chmod(abs('Projektek/Zart/Belso'), 0o755);
    }
  });
});

describe('watch modul: hozzárendelés', () => {
  it('a figyelt gyökér böngészése: almappák, a hozzárendelt mappánál a projekt neve', async () => {
    const pid = await project('Watch: böngészés');
    await put('Bongeszes/Alfa/x.txt', 'x');
    await put('Bongeszes/Béta/y.txt', 'y');
    await put('Bongeszes/.rejtett/z.txt', 'z');
    await assign(iroda, pid, 'Bongeszes/Alfa');
    const list = (await as(iroda)('GET', '/api/watch/folders?path=Bongeszes')).json();
    expect(list).toEqual({
      path: 'Bongeszes',
      folders: [
        { name: 'Alfa', path: 'Bongeszes/Alfa', project: { id: pid, name: 'Watch: böngészés' } },
        { name: 'Béta', path: 'Bongeszes/Béta', project: null },
      ],
    });
    const top = (await as(iroda)('GET', '/api/watch/folders')).json();
    expect(top.path).toBe('');
    expect(top.folders.map((f: { name: string }) => f.name)).toContain('Bongeszes');
    expect((await as(iroda)('GET', '/api/watch/folders?path=../etc')).statusCode).toBe(400);
    expect((await as(iroda)('GET', '/api/watch/folders?path=Nincs-ilyen')).statusCode).toBe(404);
  });

  it('érvénytelen, nem létező vagy a gyökéren kívüli mappa 400; ugyanaz a mappa két projekthez 409; verzió-ütközés 409', async () => {
    const p1 = await project('Watch: egyik');
    const p2 = await project('Watch: másik');
    await put('Egyedi/Mappa/a.txt', 'a');
    await put('Egyedi/Masik/b.txt', 'b');
    const outside = await mkdtemp(path.join(tmpdir(), 'watch-outside-'));
    await symlink(outside, abs('Egyedi/Kifele'));
    for (const bad of ['../kint', 'Egyedi/../..', '', '/', 'Nincs/ilyen', 'Egyedi/Mappa/a.txt', 'Egyedi/Kifele']) {
      expect((await assign(iroda, p1, bad)).statusCode, bad).toBe(400);
    }
    expect((await assign(iroda, p1, 'Egyedi/Mappa')).statusCode).toBe(200);
    const taken = await assign(iroda, p2, 'Egyedi/Mappa');
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.message).toBe('Ez a mappa már a(z) „Watch: egyik” projekthez tartozik');
    // Meglévő hozzárendelés módosítása verzió nélkül vagy régi verzióval: 409.
    expect((await assign(iroda, p1, 'Egyedi/Masik')).statusCode).toBe(409);
    expect((await assign(iroda, p1, 'Egyedi/Masik', 7)).statusCode).toBe(409);
    await rm(outside, { recursive: true, force: true });
  });

  it('csere: a korábbi almappa fájljai esemény nélkül kikerülnek, az újé alapállapotként bekerül; megszüntetés', async () => {
    const pid = await project('Watch: csere');
    await put('Csere/Regi/a.txt', 'a');
    await put('Csere/Uj/b.txt', 'b');
    await put('Csere/Uj/c.txt', 'c');
    const first = (await assign(iroda, pid, 'Csere/Regi')).json();
    const oldFileId = first.files[0].id;
    const second = (await assign(iroda, pid, 'Csere/Uj', first.mapping.version)).json();
    expect(second.mapping).toMatchObject({ path: 'Csere/Uj', version: 2, fileCount: 2 });
    expect(second.files.map((f: { path: string }) => f.path)).toEqual(['b.txt', 'c.txt']);
    expect(await watchEvents(pid)).toEqual([]);
    expect((await as(iroda)('GET', `/api/watch/files/${oldFileId}/content`)).statusCode).toBe(404);

    const audit = (await as(admin)('GET', `/api/audit?entityType=watch.mapping`)).json().items as Array<{ entityId: string; action: string; label: string }>;
    expect(audit.filter((a) => a.entityId === pid).map((a) => `${a.action} ${a.label}`)).toEqual(expect.arrayContaining(['create Csere/Regi', 'update Csere/Uj']));

    expect((await as(iroda)('DELETE', `/api/watch/projects/${pid}/mapping`)).statusCode).toBe(204);
    expect((await as(iroda)('GET', `/api/watch/projects/${pid}`)).json()).toEqual({ mapping: null, files: [] });
    expect((await scan(iroda, pid)).statusCode).toBe(404);
    expect((await as(iroda)('DELETE', `/api/watch/projects/${pid}/mapping`)).statusCode).toBe(404);
    // Felszabadult: másik projekt megkaphatja.
    expect((await assign(iroda, await project('Watch: új gazda'), 'Csere/Uj')).statusCode).toBe(200);
  });

  it('a hozzárendelések listája a látható projektekre szűrve, fájlszámmal', async () => {
    const mine = await project('Watch: lista, Tamásé', [terepesId]);
    const other = await project('Watch: lista, idegen');
    await put('Lista/Tamas/a.txt', 'a');
    await put('Lista/Idegen/b.txt', 'b');
    await assign(iroda, mine, 'Lista/Tamas');
    await assign(iroda, other, 'Lista/Idegen');
    const forTamas = (await as(terepes)('GET', '/api/watch/mappings')).json().items as Array<{ projectId: string; fileCount: number }>;
    expect(forTamas.map((m) => m.projectId)).toEqual([mine]);
    expect(forTamas[0]!.fileCount).toBe(1);
    const forIldi = (await as(iroda)('GET', '/api/watch/mappings')).json().items as Array<{ projectId: string }>;
    expect(forIldi.map((m) => m.projectId)).toEqual(expect.arrayContaining([mine, other]));
  });
});

describe('watch modul: letöltés és jogosultság', () => {
  it('a fájl letölthető (csatolmányként, ékezetes névvel), a megnyitás az auditnaplóba kerül; törölt fájlra 404', async () => {
    const pid = await project('Watch: letöltés');
    await put('Letoltes/P/Árlista.pdf', '%PDF-1.4 tartalom');
    const file = (await assign(iroda, pid, 'Letoltes/P')).json().files[0];
    const res = await as(iroda)('GET', `/api/watch/files/${file.id}/content`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('%PDF-1.4 tartalom');
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="Arlista.pdf"; filename*=UTF-8''%C3%81rlista.pdf`);
    const audit = (await as(admin)('GET', '/api/audit?entityType=watch.file&action=view')).json().items as Array<{ entityId: string }>;
    expect(audit.some((a) => a.entityId === file.id)).toBe(true);

    await rm(abs('Letoltes/P/Árlista.pdf'));
    // A bejárás előtt is 404 (a fájl már nincs a lemezen), utána is.
    expect((await as(iroda)('GET', `/api/watch/files/${file.id}/content`)).statusCode).toBe(404);
    await scan(iroda, pid);
    expect((await as(iroda)('GET', `/api/watch/files/${file.id}/content`)).statusCode).toBe(404);
    expect((await as(iroda)('GET', `/api/watch/files/${crypto.randomUUID()}/content`)).statusCode).toBe(404);
  });

  it('terepes: a hozzá rendelt projekt mappáját látja és ellenőrizheti, a többit nem; hozzárendelni és böngészni nem tud', async () => {
    const mine = await project('Watch: Tamás projektje', [terepesId]);
    const other = await project('Watch: idegen projekt');
    await put('Jog/Tamas/sajat.pdf', 'saját');
    await put('Jog/Idegen/titkos.pdf', 'titkos');
    await put('Jog/Szabad/x.txt', 'x');
    await assign(iroda, mine, 'Jog/Tamas');
    const secret = (await assign(iroda, other, 'Jog/Idegen')).json().files[0];

    expect((await as(terepes)('GET', `/api/watch/projects/${mine}`)).json().files.map((f: { path: string }) => f.path)).toEqual(['sajat.pdf']);
    expect((await scan(terepes, mine)).statusCode).toBe(200);
    expect((await as(terepes)('GET', `/api/watch/projects/${other}`)).statusCode).toBe(403);
    expect((await scan(terepes, other)).statusCode).toBe(403);
    expect((await as(terepes)('GET', `/api/watch/files/${secret.id}/content`)).statusCode).toBe(403);
    expect((await as(terepes)('GET', '/api/watch/folders')).statusCode).toBe(403);
    expect((await assign(terepes, mine, 'Jog/Szabad', 1)).statusCode).toBe(403);
    expect((await as(terepes)('DELETE', `/api/watch/projects/${mine}/mapping`)).statusCode).toBe(403);
  });
});

describe('watch modul: teszt-végpont és beállítások', () => {
  it('POST /api/test/watch-file: fájlt ír a WATCH_ROOT alá (NODE_ENV=test), a gyökérből nem léphet ki', async () => {
    const pid = await project('Watch: teszt-végpont');
    const w = (body: object) => as(iroda)('POST', '/api/test/watch-file', body);
    expect((await w({ path: 'Teszt/Vegpont/meglevo.txt', content: 'első' })).statusCode).toBe(201);
    await assign(iroda, pid, 'Teszt/Vegpont');
    expect((await w({ path: 'Teszt/Vegpont/arlista_beszallito.pdf', content: Buffer.from('%PDF').toString('base64'), encoding: 'base64' })).statusCode).toBe(201);
    expect((await scan(iroda, pid)).json()).toMatchObject({ added: 1 });
    const added = (await watchEvents(pid))[0]!;
    expect(added.title).toBe('Új fájl a szerveren: arlista_beszallito.pdf');
    expect((await as(iroda)('GET', `/api/watch/files/${added.data.fileId}/content`)).body).toBe('%PDF');
    for (const bad of ['../kint.txt', 'a/../../kint.txt', '']) expect((await w({ path: bad, content: 'x' })).statusCode, bad).toBe(400);
  });

  it('élesben (NODE_ENV=production) a teszt-végpont nincs regisztrálva', async () => {
    const prod = await createTestApp({ DERP_MODULES: 'watch', NODE_ENV: 'production', DEV_LOGIN: '0' });
    try {
      const res = await prod.app.inject({ method: 'POST', url: '/api/test/watch-file', payload: { path: 'a.txt', content: 'x' } });
      expect(res.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });

  it('WATCH_ROOT és WATCH_INTERVAL_SEC alapértékei; érvénytelen gyakoriság hiba', () => {
    expect(watchRoot({}, 'production')).toBe('/watch');
    expect(watchRoot({ WATCH_ROOT: '/mnt/x' }, 'test')).toBe('/mnt/x');
    expect(watchRoot({}, 'test')).toBe(path.join(tmpdir(), 'derp-watch-test'));
    expect(watchIntervalSec({})).toBe(300);
    expect(watchIntervalSec({ WATCH_INTERVAL_SEC: '0' })).toBe(0);
    expect(watchIntervalSec({ WATCH_INTERVAL_SEC: '60' })).toBe(60);
    expect(() => watchIntervalSec({ WATCH_INTERVAL_SEC: 'öt' })).toThrow(/WATCH_INTERVAL_SEC/);
  });

  it('ütemezett bejárás WATCH_INTERVAL_SEC szerint, gombnyomás nélkül', async () => {
    const pid = await project('Watch: ütemezett');
    await put('Utemezett/a.txt', 'a');
    await assign(iroda, pid, 'Utemezett');
    process.env.WATCH_INTERVAL_SEC = '1';
    const timed = await createTestApp({ DERP_MODULES: 'watch' });
    process.env.WATCH_INTERVAL_SEC = '0';
    try {
      await put('Utemezett/uj.txt', 'új');
      await expect.poll(async () => (await watchEvents(pid)).map((e) => e.title), { timeout: 5000, interval: 200 }).toEqual(['Új fájl a szerveren: uj.txt']);
    } finally {
      await timed.close();
    }
  });
});
