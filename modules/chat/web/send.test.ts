import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMessage, sendMessage } from './send.ts';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Egy apró „szerver”: az üzenetet és a fájlokat azonosító szerint tárolja (mint a valódi, idempotens végpontok). */
function fakeServer() {
  const messages = new Map<string, unknown>();
  const files = new Map<string, URL>();
  const folders: Array<{ id: string; name: string; parentId: null }> = [];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://x');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname.includes('/api/chat/') && method === 'PUT') {
      const id = url.pathname.split('/').at(-1)!;
      const created = !messages.has(id);
      if (created) messages.set(id, { id, eventId: 'ev-1', ...JSON.parse(init.body as string) });
      return json(messages.get(id), created ? 201 : 200);
    }
    if (url.pathname.endsWith('/folders') && method === 'POST') {
      const folder = { id: 'folder-chat', name: JSON.parse(init.body as string).name, parentId: null };
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
  return { messages, files, folders, calls };
}

describe('chat-üzenet küldése csatolmánnyal', () => {
  it('előbb az üzenet, utána a fájlok a „Chat” mappába, az üzenet eseménye alá', async () => {
    const server = fakeServer();
    const projectId = crypto.randomUUID();
    const m = await prepareMessage(projectId, '  Fotó a gépházról  ', [new File(['jpg'], 'gephaz.txt', { type: 'text/plain' })]);
    expect(m.body).toBe('Fotó a gépházról');

    await sendMessage(m);
    expect(server.calls).toEqual([
      `PUT /api/chat/projects/${projectId}/messages/${m.id}`,
      `GET /api/docs/projects/${projectId}`,
      `POST /api/docs/projects/${projectId}/folders`,
      `PUT /api/docs/projects/${projectId}/files/${m.attachments[0]!.id}`,
    ]);
    expect(server.messages.get(m.id)).toMatchObject({ body: 'Fotó a gépházról', attachments: [{ id: m.attachments[0]!.id, name: 'gephaz.txt' }] });
    const upload = server.files.get(m.attachments[0]!.id)!;
    expect(upload.searchParams.get('parentEventId')).toBe('ev-1');
    expect(upload.searchParams.get('folderId')).toBe('folder-chat');
  });

  it('újraküldve ugyanazokkal az azonosítókkal megy, és a meglévő mappát használja', async () => {
    const server = fakeServer();
    const m = await prepareMessage(crypto.randomUUID(), 'Kettő', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
    await sendMessage(m);
    await sendMessage(m);
    expect(server.messages.size).toBe(1);
    expect(server.files.size).toBe(2);
    expect(server.folders).toHaveLength(1);
  });
});
