// MIME-típus a feltöltéshez és a kiszolgáláshoz.

const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  dwg: 'application/acad',
  zip: 'application/zip',
};

const VALID = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;

/** A kliens által megadott típus (paraméterek nélkül, kisbetűvel), ha érvényes; különben a kiterjesztésből. */
export function resolveMime(declared: string | undefined, fileName: string): string {
  const base = declared?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (VALID.test(base) && base !== 'application/octet-stream') return base;
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && BY_EXTENSION[ext]) || 'application/octet-stream';
}

/** Ezekből készül bélyegkép (`sharp`). Az SVG-ből nem: azt a böngésző sem kapja meg beágyazva. */
const THUMB_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif', 'image/tiff']);
export const canThumb = (mime: string): boolean => THUMB_TYPES.has(mime);

/**
 * A böngészőben megnyitható (előnézet) típusok; minden más letöltésként megy ki. Az SVG és a HTML azért nincs itt,
 * mert az alkalmazás saját címén futó szkriptet hordozhat.
 */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf', 'text/plain', 'video/mp4']);
export const isInline = (mime: string): boolean => INLINE_TYPES.has(mime);
