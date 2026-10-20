import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** A feltöltés túllépte a megengedett méretet. */
export class TooLargeError extends Error {}

export interface TempBlob {
  path: string;
  sha256: string;
  size: number;
}

/**
 * Tartalom szerint címzett fájltár a `DATA_DIR` alatt: `blobs/ab/cd/<sha256>` (az első két bájt két könyvtárszint,
 * hogy egy könyvtárban se legyen túl sok fájl), a bélyegkép `thumbs/ab/cd/<sha256>.webp`. A feltöltés előbb a
 * `tmp/` alá íródik (közben hash-elve), és csak a metaadat rögzítésekor kerül a végleges helyére; a törlés előbb a
 * `trash/` alá mozgat, így egy meghiúsult tranzakció után visszaállítható.
 */
export class BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  static shard(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`érvénytelen sha256: ${sha256}`);
    return path.join(sha256.slice(0, 2), sha256.slice(2, 4));
  }

  blobPath(sha256: string): string {
    return path.join(this.root, 'blobs', BlobStore.shard(sha256), sha256);
  }

  thumbPath(sha256: string): string {
    return path.join(this.root, 'thumbs', BlobStore.shard(sha256), `${sha256}.webp`);
  }

  async init(): Promise<void> {
    for (const dir of ['blobs', 'thumbs', 'tmp', 'trash']) await mkdir(path.join(this.root, dir), { recursive: true });
  }

  /** A folyamot ideiglenes fájlba írja és közben hash-eli; `maxBytes` fölött `TooLargeError`. */
  async writeTemp(source: Readable, maxBytes: number): Promise<TempBlob> {
    const tmp = path.join(this.root, 'tmp', randomUUID());
    await mkdir(path.dirname(tmp), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            size += chunk.length;
            if (size > maxBytes) throw new TooLargeError(`a fájl nagyobb, mint ${Math.round(maxBytes / 1024 / 1024)} MB`);
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(tmp, { flags: 'wx' }),
      );
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return { path: tmp, sha256: hash.digest('hex'), size };
  }

  async exists(sha256: string): Promise<boolean> {
    return stat(this.blobPath(sha256)).then(
      () => true,
      () => false,
    );
  }

  /** Az ideiglenes fájl a végleges helyére; ha a blob már megvan (duplikáció), az ideiglenes fájl törlődik. */
  async commit(temp: TempBlob): Promise<void> {
    const target = this.blobPath(temp.sha256);
    if (await this.exists(temp.sha256)) {
      await rm(temp.path, { force: true });
      return;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await rename(temp.path, target);
  }

  async discard(temp: TempBlob): Promise<void> {
    await rm(temp.path, { force: true });
  }

  /**
   * A blob és a bélyegképe a `trash/` alá kerül; a visszaadott `finish` véglegesen törli, a `restore` visszateszi
   * (ha a törlést rögzítő tranzakció meghiúsult).
   */
  async moveToTrash(sha256: string): Promise<{ finish: () => Promise<void>; restore: () => Promise<void> }> {
    const moved: Array<[from: string, to: string]> = [];
    for (const from of [this.blobPath(sha256), this.thumbPath(sha256)]) {
      const to = path.join(this.root, 'trash', `${path.basename(from)}.${randomUUID()}`);
      try {
        await rename(from, to);
        moved.push([from, to]);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return {
      finish: async () => {
        for (const [, to] of moved) await rm(to, { force: true });
      },
      restore: async () => {
        for (const [from, to] of moved) await rename(to, from);
      },
    };
  }
}
