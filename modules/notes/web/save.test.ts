import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseQuantity, prepareNote, prepareSurvey, sendNote, sendSurvey } from './save.ts';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Egy apró „szerver”: a felmérést, a jegyzetet és a fájlokat azonosító szerint tárolja (mint a valódi, idempotens végpontok). */
function fakeServer() {
  const records = new Map<string, unknown>();
  const files = new Map<string, URL>();
  const folders: Array<{ id: string; name: string; parentId: null }> = [];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://x');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname.startsWith('/api/notes/') && method === 'PUT') {
      const id = url.pathname.split('/').at(-1)!;
      const created = !records.has(id);
      if (created) records.set(id, { id, eventId: 'ev-survey', ...JSON.parse(init.body as string) });
      return json(records.get(id), created ? 201 : 200);
    }
    if (url.pathname.endsWith('/folders') && method === 'POST') {
      const folder = { id: 'folder-surveys', name: JSON.parse(init.body as string).name, parentId: null };
      folders.push(folder);
      return json(folder, 201);
    }
    if (url.pathname.startsWith('/api/docs/projects/') && method === 'GET') return json({ folders, files: [] });
    if (url.pathname.includes('/files/') && method === 'PUT') {
      const id = url.pathname.split('/').at(-1)!;
      const created = !files.has(id);
      files.set(id, url);
      return json({ id }, created ? 201 : 200);
    }
    return json({ error: { code: 'not_found', message: 'nincs' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { records, files, folders, calls };
}

const fields = {
  location: '  Gépház  ',
  condition: ' Zajos ventilátor ',
  proposedWork: 'Csere',
  materials: [{ name: ' Ventilátor ', quantity: 1, unit: ' db ' }],
};

describe('felmérés mentése fotókkal', () => {
  it('előbb a felmérés, utána a fotók a „Felmérések” mappába, a felmérés eseménye alá', async () => {
    const server = fakeServer();
    const projectId = crypto.randomUUID();
    const s = await prepareSurvey(projectId, fields, [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]);
    expect(s).toMatchObject({ location: 'Gépház', condition: 'Zajos ventilátor', materials: [{ name: 'Ventilátor', quantity: 1, unit: 'db' }] });

    const progress: number[] = [];
    await sendSurvey(s, (p) => progress.push(p.uploaded));
    expect(server.calls).toEqual([
      `PUT /api/notes/projects/${projectId}/surveys/${s.id}`,
      `GET /api/docs/projects/${projectId}`,
      `POST /api/docs/projects/${projectId}/folders`,
      `PUT /api/docs/projects/${projectId}/files/${s.photos[0]!.id}`,
      `PUT /api/docs/projects/${projectId}/files/${s.photos[1]!.id}`,
    ]);
    expect(progress).toEqual([0, 1, 2]);
    expect(server.records.get(s.id)).toMatchObject({
      location: 'Gépház',
      photos: [
        { id: s.photos[0]!.id, name: 'a.jpg' },
        { id: s.photos[1]!.id, name: 'b.jpg' },
      ],
    });
    for (const p of s.photos) {
      const upload = server.files.get(p.id)!;
      expect(upload.searchParams.get('parentEventId')).toBe('ev-survey');
      expect(upload.searchParams.get('folderId')).toBe('folder-surveys');
    }
  });

  it('újraküldve ugyanazokkal az azonosítókkal megy, és a meglévő mappát használja', async () => {
    const server = fakeServer();
    const s = await prepareSurvey(crypto.randomUUID(), fields, [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]);
    await sendSurvey(s);
    await sendSurvey(s);
    expect(server.records.size).toBe(1);
    expect(server.files.size).toBe(2);
    expect(server.folders).toHaveLength(1);
  });

  it('fotó nélkül nem nyúl a dokumentumtárhoz', async () => {
    const server = fakeServer();
    const s = await prepareSurvey(crypto.randomUUID(), fields);
    await sendSurvey(s);
    expect(server.calls).toHaveLength(1);
  });
});

describe('jegyzet mentése', () => {
  it('kliens UUID-val, újraküldve sem duplikál', async () => {
    const server = fakeServer();
    const n = prepareNote(crypto.randomUUID(), '  Kapukód: 1234  ');
    expect(n.body).toBe('Kapukód: 1234');
    await sendNote(n);
    await sendNote(n);
    expect(server.records.size).toBe(1);
    expect(server.calls).toEqual([`PUT /api/notes/projects/${n.projectId}/notes/${n.id}`, `PUT /api/notes/projects/${n.projectId}/notes/${n.id}`]);
  });
});

describe('mennyiség', () => {
  it.each([
    ['2,5', 2.5],
    ['2.5', 2.5],
    ['1 000', 1000],
    [' 3 ', 3],
    ['0', null],
    ['-1', null],
    ['abc', null],
    ['', null],
    ['1,2,3', null],
  ])('%s → %s', (text, value) => expect(parseQuantity(text)).toBe(value));
});
