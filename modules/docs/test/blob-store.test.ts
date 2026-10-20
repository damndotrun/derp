import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlobStore, TooLargeError } from '../server/blob-store.ts';
import { canThumb, isInline, resolveMime } from '../server/mime.ts';
import { contentDisposition } from '../server/routes.ts';

let root: string;
let store: BlobStore;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'docs-store-'));
  store = new BlobStore(root);
  await store.init();
});
afterEach(() => rm(root, { recursive: true, force: true }));

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe('BlobStore', () => {
  it('hash-útvonal: blobs/<2 hex>/<2 hex>/<sha256>, a bélyegkép thumbs/…/<sha256>.webp', () => {
    const h = sha('alma');
    expect(path.relative(root, store.blobPath(h))).toBe(path.join('blobs', h.slice(0, 2), h.slice(2, 4), h));
    expect(path.relative(root, store.thumbPath(h))).toBe(path.join('thumbs', h.slice(0, 2), h.slice(2, 4), `${h}.webp`));
    expect(() => store.blobPath('../../etc/passwd')).toThrow(/érvénytelen sha256/);
    expect(() => store.blobPath(h.toUpperCase())).toThrow(/érvénytelen sha256/);
  });

  it('írás közben hash-el, és a végleges helyre teszi', async () => {
    const body = Buffer.from('légtechnikai felmérés');
    const temp = await store.writeTemp(Readable.from([body.subarray(0, 5), body.subarray(5)]), 1024);
    expect(temp).toMatchObject({ sha256: sha(body), size: body.length });
    await store.commit(temp);
    expect(await readFile(store.blobPath(temp.sha256))).toEqual(body);
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  });

  it('duplikáció: azonos tartalom egyszer kerül a lemezre', async () => {
    const a = await store.writeTemp(Readable.from([Buffer.from('ugyanaz')]), 1024);
    const b = await store.writeTemp(Readable.from([Buffer.from('ugyanaz')]), 1024);
    expect(a.sha256).toBe(b.sha256);
    await store.commit(a);
    await store.commit(b);
    const shard = path.dirname(store.blobPath(a.sha256));
    expect(await readdir(shard)).toEqual([a.sha256]);
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  });

  it('a méretkorlát fölött TooLargeError, és nem marad ideiglenes fájl', async () => {
    await expect(store.writeTemp(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000)).rejects.toBeInstanceOf(TooLargeError);
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  });

  it('a kukába tett blob visszaállítható, vagy véglegesen törölhető', async () => {
    const temp = await store.writeTemp(Readable.from([Buffer.from('törlendő')]), 1024);
    await store.commit(temp);
    await mkdir(path.dirname(store.thumbPath(temp.sha256)), { recursive: true });
    await writeFile(store.thumbPath(temp.sha256), 'thumb');
    const first = await store.moveToTrash(temp.sha256);
    expect(await store.exists(temp.sha256)).toBe(false);
    await first.restore();
    expect(await store.exists(temp.sha256)).toBe(true);
    expect(await readFile(store.thumbPath(temp.sha256), 'utf8')).toBe('thumb');

    const second = await store.moveToTrash(temp.sha256);
    await second.finish();
    expect(await store.exists(temp.sha256)).toBe(false);
    expect(await readdir(path.join(root, 'trash'))).toEqual([]);
  });
});

describe('MIME és fejlécek', () => {
  it('a megadott típus érvényes, különben a kiterjesztésből', () => {
    expect(resolveMime('image/JPEG; charset=x', 'a.bin')).toBe('image/jpeg');
    expect(resolveMime('', 'Alaprajz.PDF')).toBe('application/pdf');
    expect(resolveMime('application/octet-stream', 'foto.heic')).toBe('image/heic');
    expect(resolveMime('nem típus', 'ismeretlen')).toBe('application/octet-stream');
  });

  it('bélyegkép csak raszterképből, böngészőben csak biztonságos típus nyílik meg', () => {
    expect(canThumb('image/jpeg')).toBe(true);
    expect(canThumb('image/svg+xml')).toBe(false);
    expect(isInline('application/pdf')).toBe(true);
    expect(isInline('image/svg+xml')).toBe(false);
    expect(isInline('text/html')).toBe(false);
  });

  it('Content-Disposition ékezetes névvel és ASCII tartalékkal', () => {
    expect(contentDisposition('attachment', 'Árajánlat "v2".pdf')).toBe(
      `attachment; filename="Arajanlat _v2_.pdf"; filename*=UTF-8''%C3%81raj%C3%A1nlat%20%22v2%22.pdf`,
    );
  });
});
