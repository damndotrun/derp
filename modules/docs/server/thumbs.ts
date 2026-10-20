import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/** A bélyegkép hosszabb éle pixelben (a rácsban kb. 160 px, nagy felbontású kijelzőn kétszeres). */
export const THUMB_SIZE = 400;

let configured = false;

/**
 * Bélyegkép (WebP) a forrásképből az EXIF-tájolás szerint elforgatva. A `sharp` csak itt töltődik be; a gyorsítótár
 * ki van kapcsolva és egyszerre egy kép készül, hogy a 384 MB-os konténerkorlát mellett is elférjen.
 * Olvashatatlan vagy nem támogatott képnél `false`.
 */
export async function makeThumb(source: string, target: string): Promise<boolean> {
  const sharp = (await import('sharp')).default;
  if (!configured) {
    sharp.cache(false);
    sharp.concurrency(1);
    configured = true;
  }
  const tmp = `${target}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await sharp(source, { failOn: 'error' })
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(tmp);
    await rename(tmp, target);
    return true;
  } catch {
    await rm(tmp, { force: true });
    return false;
  }
}
