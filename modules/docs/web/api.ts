import { ApiError, request } from '@/core/api.ts';
import type { DocsFile, DocsFolder, FileUpdate, FolderCreate, FolderUpdate, ProjectDocs } from '../shared.ts';

export const docsKey = (projectId: string) => ['docs', projectId] as const;

export const fileUrls = (fileId: string) => ({
  /** Előnézet (képek, PDF böngészőben; más típus letöltésként). */
  content: `/api/docs/files/${fileId}/content`,
  download: `/api/docs/files/${fileId}/content?download=1`,
  thumb: `/api/docs/files/${fileId}/thumb`,
});

export const docsApi = {
  project: (projectId: string) => request<ProjectDocs>('GET', `/api/docs/projects/${projectId}`),
  file: (fileId: string) => request<DocsFile>('GET', `/api/docs/files/${fileId}`),
  updateFile: (fileId: string, body: FileUpdate) => request<DocsFile>('PATCH', `/api/docs/files/${fileId}`, body),
  deleteFile: (fileId: string) => request<void>('DELETE', `/api/docs/files/${fileId}`),
  createFolder: (projectId: string, body: FolderCreate) => request<DocsFolder>('POST', `/api/docs/projects/${projectId}/folders`, body),
  updateFolder: (folderId: string, body: FolderUpdate) => request<DocsFolder>('PATCH', `/api/docs/folders/${folderId}`, body),
  deleteFolder: (folderId: string) => request<void>('DELETE', `/api/docs/folders/${folderId}`),
};

/** A mag hibaformátumú válaszából `ApiError` (a feltöltés nyers törzzsel megy, ezért nem a `request`-tel). */
export async function toApiError(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  return new ApiError(res.status, payload?.error?.code ?? 'http', payload?.error?.message ?? res.statusText);
}
