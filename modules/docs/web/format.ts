/** Fájlméret magyar formában (pl. „1,2 MB”). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat('hu-HU', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

/** A fájlnév kiterjesztése nagybetűvel (a bélyegkép nélküli fájlok jelölésére), pl. „PDF”. */
export function extensionLabel(name: string): string {
  return name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toUpperCase() ?? '?';
}

export const isImage = (mime: string) => mime.startsWith('image/');
