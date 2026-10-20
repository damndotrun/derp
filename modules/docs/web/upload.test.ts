import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/core/api.ts';
import { fitWithin, MAX_EDGE, newId, prepareUpload, sendUpload, sha256Hex, uploadUrl } from './upload.ts';

afterEach(() => vi.unstubAllGlobals());

describe('feltöltés a böngészőből', () => {
  it('a fotó hosszabb éle legfeljebb 2560 px, a kisebb kép nem nő', () => {
    expect(MAX_EDGE).toBe(2560);
    expect(fitWithin(4032, 3024)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1920, height: 2560 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it('sha256 hexben, és kliens oldali UUID', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('a feltöltés PUT a kliens azonosítóval, nyers törzzsel, a metaadat a címben', async () => {
    const file = new File(['%PDF'], 'Árlista beszállító.pdf', { type: 'application/pdf' });
    const projectId = crypto.randomUUID();
    const u = await prepareUpload(projectId, file, { folderId: 'f1' });
    expect(u).toMatchObject({ projectId, name: 'Árlista beszállító.pdf', type: 'application/pdf', folderId: 'f1', parentEventId: null });
    expect(u.sha256).toHaveLength(64);

    const url = new URL(uploadUrl(u), 'http://x');
    expect(url.pathname).toBe(`/api/docs/projects/${projectId}/files/${u.id}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'Árlista beszállító.pdf',
      type: 'application/pdf',
      sha256: u.sha256,
      folderId: 'f1',
      capturedAt: u.capturedAt,
    });
    // A kliens oldali időbélyeg (offline sor): az előkészítés ideje.
    expect(Math.abs(Date.parse(u.capturedAt!) - Date.now())).toBeLessThan(10_000);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: u.id }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendUpload(u)).resolves.toEqual({ id: u.id });
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(uploadUrl(u));
    expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: u.blob });
  });

  it('a hibaválaszból ApiError a mag hibaformátumával', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Nincs jogosultság' } }), { status: 403 }));
    const u = await prepareUpload(crypto.randomUUID(), new File(['x'], 'x.txt', { type: 'text/plain' }));
    const err = await sendUpload(u).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, message: 'Nincs jogosultság' });
  });
});
