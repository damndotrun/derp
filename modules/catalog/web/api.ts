import { request } from '@/core/api.ts';
import type { CatalogItem, CatalogList, ImportPreview, ImportRequest, ImportResult } from '../shared/schemas.ts';

export const catalogKey = ['catalog'] as const;

export const catalogApi = {
  list: (q: { q?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (q.q) params.set('q', q.q);
    if (q.limit) params.set('limit', String(q.limit));
    if (q.offset) params.set('offset', String(q.offset));
    return request<CatalogList>('GET', `/api/catalog/items?${params}`);
  },
  item: (id: string) => request<CatalogItem>('GET', `/api/catalog/items/${id}`),
  preview: (body: ImportRequest) => request<ImportPreview>('POST', '/api/catalog/import/preview', body),
  import: (body: ImportRequest) => request<ImportResult>('POST', '/api/catalog/import', body),
};

/** A fájl tartalma base64-ben (a kódolást a szerver ismeri fel). */
export async function fileToImport(file: File): Promise<ImportRequest> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { fileName: file.name, content: btoa(binary) };
}
