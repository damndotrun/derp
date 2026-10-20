import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from '../../../apps/server/test/helpers.ts';
import type { Note, ProjectNotes, Survey } from '../shared.ts';

let ctx: TestContext;
let dataDir: string;
let admin: string;
let iroda: string;
let terepes: string;
let terepesId: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'notes-api-'));
  process.env.DATA_DIR = dataDir;
  ctx = await createTestApp({ DERP_MODULES: 'docs,notes' });
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

const as = (cookie: string) => requester(ctx.app, cookie);

async function project(name: string, members: string[] = []): Promise<string> {
  const p = (await as(admin)('POST', '/api/projects', { name })).json();
  for (const m of members) expect((await as(admin)('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

const putSurvey = (cookie: string, projectId: string, body: object, id: string = crypto.randomUUID()) =>
  as(cookie)('PUT', `/api/notes/projects/${projectId}/surveys/${id}`, body);
const putNote = (cookie: string, projectId: string, body: object, id: string = crypto.randomUUID()) =>
  as(cookie)('PUT', `/api/notes/projects/${projectId}/notes/${id}`, body);

const survey = (over: Record<string, unknown> = {}) => ({
  location: 'Gépház, 2. emelet',
  condition: 'A légkezelő ventilátora zajos, a szűrő eltömődött.',
  proposedWork: 'Ventilátorcsere és szűrőcsere.',
  materials: [
    { name: 'Radiálventilátor', quantity: 1, unit: 'db' },
    { name: 'Zsákos szűrő F7', quantity: 2.5, unit: 'm²' },
  ],
  ...over,
});

type EventItem = { id: string; type: string; title: string; parentId: string | null; data: Record<string, unknown> };
const events = async (projectId: string): Promise<EventItem[]> => (await as(admin)('GET', `/api/projects/${projectId}/events`)).json().items;

function upload(cookie: string, projectId: string, id: string, query: Record<string, string>) {
  const qs = new URLSearchParams({ name: 'foto.jpg', type: 'image/jpeg', ...query });
  return ctx.app.inject({
    method: 'PUT',
    url: `/api/docs/projects/${projectId}/files/${id}?${qs}`,
    payload: Buffer.from(`kép ${id}`),
    headers: { cookie, 'content-type': 'application/octet-stream' },
  });
}

describe('notes: felmérés kötelező mezői', () => {
  it.each([
    ['helyszín', { location: '  ' }],
    ['észlelt állapot', { condition: '' }],
    ['javasolt munka', { proposedWork: undefined }],
    ['becsült anyag (üres lista)', { materials: [] }],
    ['becsült anyag (hiányzó lista)', { materials: undefined }],
    ['anyagtétel megnevezése', { materials: [{ name: ' ', quantity: 1, unit: 'db' }] }],
    ['anyagtétel mennyisége', { materials: [{ name: 'Cső', unit: 'm' }] }],
    ['anyagtétel pozitív mennyisége', { materials: [{ name: 'Cső', quantity: 0, unit: 'm' }] }],
    ['anyagtétel egysége', { materials: [{ name: 'Cső', quantity: 3 }] }],
  ])('hiányzó %s: 400, nincs rekord és esemény', async (_label, over) => {
    const pid = await project('Felmérés: kötelező mezők');
    const id = crypto.randomUUID();
    const res = await putSurvey(iroda, pid, survey(over), id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
    const rows = await ctx.pool.query('SELECT count(*)::int AS n FROM notes_surveys WHERE id = $1', [id]);
    expect(rows.rows[0].n).toBe(0);
    expect((await events(pid)).filter((e) => e.type === 'notes.survey_added')).toHaveLength(0);
  });

  it('minden kötelező mezővel 201, a szövegek levágva, a tételek sorrendben', async () => {
    const pid = await project('Felmérés: teljes');
    const res = await putSurvey(iroda, pid, survey({ location: '  Gépház  ' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      projectId: pid,
      author: { name: 'Iroda Ildi' },
      location: 'Gépház',
      materials: [
        { name: 'Radiálventilátor', quantity: 1, unit: 'db' },
        { name: 'Zsákos szűrő F7', quantity: 2.5, unit: 'm²' },
      ],
      photos: [],
    });
  });
});

describe('notes: idempotens létrehozás kliens UUID-val', () => {
  it('ugyanazzal a UUID-val kétszer küldve egy rekord, egy esemény, egy auditbejegyzés', async () => {
    const pid = await project('Felmérés: idempotencia');
    const id = crypto.randomUUID();
    const first = await putSurvey(iroda, pid, survey(), id);
    expect(first.statusCode).toBe(201);
    const created = first.json() as Survey;

    const again = await putSurvey(iroda, pid, survey(), id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(created);

    // Párhuzamos újraküldés sem duplikál.
    const parallel = await Promise.all([1, 2, 3].map(() => putSurvey(iroda, pid, survey(), id)));
    expect(parallel.map((r) => r.statusCode)).toEqual([200, 200, 200]);

    const rows = await ctx.pool.query('SELECT count(*)::int AS n FROM notes_surveys WHERE id = $1', [id]);
    expect(rows.rows[0].n).toBe(1);
    const added = (await events(pid)).filter((e) => e.type === 'notes.survey_added');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      id: created.eventId,
      title: 'Felmérés: Gépház, 2. emelet',
      data: { surveyId: id, location: 'Gépház, 2. emelet', proposedWork: 'Ventilátorcsere és szűrőcsere.', photos: 0 },
    });
    const audit = (await as(admin)('GET', '/api/audit?entityType=notes.survey')).json().items as Array<{ entityId: string; action: string }>;
    expect(audit.filter((a) => a.entityId === id && a.action === 'create')).toHaveLength(1);
  });

  it('párhuzamos első küldés is egy rekordot ad', async () => {
    const pid = await project('Felmérés: párhuzamos első küldés');
    const id = crypto.randomUUID();
    const res = await Promise.all([1, 2, 3].map(() => putSurvey(iroda, pid, survey(), id)));
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    const rows = await ctx.pool.query('SELECT count(*)::int AS n FROM notes_surveys WHERE id = $1', [id]);
    expect(rows.rows[0].n).toBe(1);
    expect((await events(pid)).filter((e) => e.type === 'notes.survey_added')).toHaveLength(1);
  });

  it('ugyanazzal az azonosítóval más tartalom, más szerző vagy más projekt: 409', async () => {
    const pid = await project('Felmérés: ütközés', [terepesId]);
    const other = await project('Felmérés: ütközés 2');
    const id = crypto.randomUUID();
    expect((await putSurvey(iroda, pid, survey(), id)).statusCode).toBe(201);
    expect((await putSurvey(iroda, pid, survey({ location: 'Pince' }), id)).statusCode).toBe(409);
    expect((await putSurvey(iroda, pid, survey({ materials: [{ name: 'Radiálventilátor', quantity: 2, unit: 'db' }] }), id)).statusCode).toBe(409);
    expect((await putSurvey(terepes, pid, survey(), id)).statusCode).toBe(409);
    expect((await putSurvey(iroda, other, survey(), id)).statusCode).toBe(409);
  });

  it('jegyzet: ugyanazzal a UUID-val kétszer küldve egy rekord és egy esemény; üres jegyzet 400', async () => {
    const pid = await project('Jegyzet: idempotencia');
    const id = crypto.randomUUID();
    const first = await putNote(iroda, pid, { body: '  A kapukód 1234, a gondnok délután van bent.  ' }, id);
    expect(first.statusCode).toBe(201);
    const note = first.json() as Note;
    expect(note).toMatchObject({ id, body: 'A kapukód 1234, a gondnok délután van bent.', author: { name: 'Iroda Ildi' } });

    const again = await putNote(iroda, pid, { body: 'A kapukód 1234, a gondnok délután van bent.' }, id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(note);
    expect((await putNote(iroda, pid, { body: 'Más szöveg' }, id)).statusCode).toBe(409);

    const rows = await ctx.pool.query('SELECT count(*)::int AS n FROM notes_notes WHERE id = $1', [id]);
    expect(rows.rows[0].n).toBe(1);
    const added = (await events(pid)).filter((e) => e.type === 'notes.note_added');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id: note.eventId, title: 'Helyszíni jegyzet: A kapukód 1234, a gondnok délután van bent.' });

    expect((await putNote(iroda, pid, { body: '   ' })).statusCode).toBe(400);
    expect((await putNote(iroda, pid, {})).statusCode).toBe(400);
  });
});

describe('notes: fotók a dokumentumtárból', () => {
  it('a fotók a felmérés eseménye alá kerülnek; a felmérés a fotók állapotát mutatja', async () => {
    const pid = await project('Felmérés: fotók');
    const photoIds = [crypto.randomUUID(), crypto.randomUUID()];
    const res = await putSurvey(iroda, pid, survey({ photos: photoIds.map((id, i) => ({ id, name: `foto${i + 1}.jpg` })) }));
    expect(res.statusCode).toBe(201);
    const s = res.json() as Survey;
    expect(s.photos.map((p) => p.status)).toEqual(['pending', 'pending']);

    for (const [i, id] of photoIds.entries()) {
      expect((await upload(iroda, pid, id, { name: `foto${i + 1}.jpg`, parentEventId: s.eventId! })).statusCode).toBe(201);
    }
    const list = (await as(iroda)('GET', `/api/notes/projects/${pid}`)).json() as ProjectNotes;
    expect(list.surveys[0]!.photos).toMatchObject([
      { id: photoIds[0], name: 'foto1.jpg', status: 'ready', mime: 'image/jpeg' },
      { id: photoIds[1], name: 'foto2.jpg', status: 'ready', mime: 'image/jpeg' },
    ]);

    const all = await events(pid);
    const photoEvents = all.filter((e) => e.type === 'docs.file_uploaded');
    expect(photoEvents).toHaveLength(2);
    expect(photoEvents.every((e) => e.parentId === s.eventId)).toBe(true);
    expect(all.find((e) => e.id === s.eventId)!.data.photos).toBe(2);

    // Ha a fotót törlik a dokumentumtárból, a felmérés „törölve” állapotot mutat.
    expect((await as(admin)('DELETE', `/api/docs/files/${photoIds[0]}`)).statusCode).toBe(204);
    const after = (await as(iroda)('GET', `/api/notes/surveys/${s.id}`)).json() as Survey;
    expect(after.photos.map((p) => p.status)).toEqual(['deleted', 'ready']);
  });

  it('másik projekt fotója nem csatolható (400); egy fotó kétszer 400', async () => {
    const pid = await project('Felmérés: idegen fotó');
    const other = await project('Felmérés: idegen fotó 2');
    const foreign = crypto.randomUUID();
    expect((await upload(iroda, other, foreign, {})).statusCode).toBe(201);
    expect((await putSurvey(iroda, pid, survey({ photos: [{ id: foreign, name: 'foto.jpg' }] }))).statusCode).toBe(400);
    const dup = crypto.randomUUID();
    expect((await putSurvey(iroda, pid, survey({ photos: [{ id: dup, name: 'a.jpg' }, { id: dup, name: 'b.jpg' }] }))).statusCode).toBe(400);
  });
});

describe('notes: lista és jogosultság', () => {
  it('a projekt jegyzetei és felmérései a legújabbal kezdve', async () => {
    const pid = await project('Felmérés: lista');
    await putNote(iroda, pid, { body: 'Első jegyzet' });
    await putNote(iroda, pid, { body: 'Második jegyzet' });
    await putSurvey(iroda, pid, survey({ location: 'Tető' }));
    const list = (await as(iroda)('GET', `/api/notes/projects/${pid}`)).json() as ProjectNotes;
    expect(list.notes.map((n) => n.body)).toEqual(['Második jegyzet', 'Első jegyzet']);
    expect(list.surveys.map((s) => s.location)).toEqual(['Tető']);
  });

  it('a terepes a hozzá rendelt projektben ír és olvas; a nem hozzá rendeltnél 403', async () => {
    const mine = await project('Felmérés: terepesé', [terepesId]);
    const notMine = await project('Felmérés: nem a terepesé');
    const s = (await putSurvey(terepes, mine, survey())).json() as Survey;
    expect(s.author.name).toBe('Terepes Tamás');
    expect((await putNote(terepes, mine, { body: 'Megérkeztem.' })).statusCode).toBe(201);
    expect((await as(terepes)('GET', `/api/notes/surveys/${s.id}`)).statusCode).toBe(200);

    const foreignSurvey = (await putSurvey(iroda, notMine, survey())).json() as Survey;
    expect((await as(terepes)('GET', `/api/notes/projects/${notMine}`)).statusCode).toBe(403);
    expect((await putSurvey(terepes, notMine, survey())).statusCode).toBe(403);
    expect((await putNote(terepes, notMine, { body: 'x' })).statusCode).toBe(403);
    expect((await as(terepes)('GET', `/api/notes/surveys/${foreignSurvey.id}`)).statusCode).toBe(403);
  });

  it('nem létező felmérés vagy projekt: 404', async () => {
    expect((await as(iroda)('GET', `/api/notes/surveys/${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect((await as(iroda)('GET', `/api/notes/projects/${crypto.randomUUID()}`)).statusCode).toBe(404);
  });

  it('belépés nélkül 401', async () => {
    const pid = await project('Felmérés: belépés nélkül');
    expect((await requester(ctx.app)('GET', `/api/notes/projects/${pid}`)).statusCode).toBe(401);
  });
});

describe('notes: kliens oldali időbélyeg (capturedAt, offline sor)', () => {
  const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
  type Ev = EventItem & { occurredAt: string };
  const occurred = async (pid: string, type: string) => ((await events(pid)) as Ev[]).find((e) => e.type === type)!.occurredAt;

  it('az offline kitöltött felmérés és fotói, valamint a jegyzet a terepi időponttal kerülnek az idővonalra', async () => {
    const pid = await project('Felmérés: terepi időpont');
    const at = agoIso(2 * 3_600_000);
    const photoId = crypto.randomUUID();
    const res = await putSurvey(iroda, pid, survey({ photos: [{ id: photoId, name: 'foto.jpg' }], capturedAt: at }));
    expect(res.statusCode).toBe(201);
    expect((res.json() as Survey).createdAt).toBe(at);
    expect(await occurred(pid, 'notes.survey_added')).toBe(at);
    expect((await upload(iroda, pid, photoId, { parentEventId: res.json().eventId, capturedAt: at })).statusCode).toBe(201);
    expect(await occurred(pid, 'docs.file_uploaded')).toBe(at);

    const noteAt = agoIso(90 * 60_000);
    const note = await putNote(iroda, pid, { body: 'Offline írva', capturedAt: noteAt });
    expect((note.json() as Note).createdAt).toBe(noteAt);
    expect(await occurred(pid, 'notes.note_added')).toBe(noteAt);
  });

  it('jövőbeli időpont helyett a szerver ideje; 30 napnál régebbi helyett a szerverre érkezésé', async () => {
    const pid = await project('Felmérés: időbélyeg korlátai');
    const before = Date.now();
    await putNote(iroda, pid, { body: 'Siető óra', capturedAt: new Date(Date.now() + 3_600_000).toISOString() });
    await putSurvey(iroda, pid, survey({ capturedAt: agoIso(31 * 24 * 3_600_000) }));
    for (const type of ['notes.note_added', 'notes.survey_added']) {
      const t = Date.parse(await occurred(pid, type));
      expect(t).toBeGreaterThanOrEqual(before - 1_000);
      expect(t).toBeLessThanOrEqual(Date.now() + 1_000);
    }
  });

  it('újraküldve más időbélyeggel is ugyanaz a rekord (200), az első időponttal; érvénytelen formátum 400', async () => {
    const pid = await project('Felmérés: időbélyeg újraküldéskor');
    const id = crypto.randomUUID();
    const first = agoIso(3_600_000);
    expect((await putNote(iroda, pid, { body: 'Kétszer küldve', capturedAt: first }, id)).statusCode).toBe(201);
    const again = await putNote(iroda, pid, { body: 'Kétszer küldve', capturedAt: agoIso(60_000) }, id);
    expect(again.statusCode).toBe(200);
    expect((again.json() as Note).createdAt).toBe(first);
    expect((await events(pid)).filter((e) => e.type === 'notes.note_added')).toHaveLength(1);
    expect((await putNote(iroda, pid, { body: 'Rossz idő', capturedAt: 'tegnap' })).statusCode).toBe(400);
  });
});
