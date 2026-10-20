import { request } from '@/core/api.ts';
import type { FolderList, MappingList, MappingSet, ProjectWatch, ScanResult } from '../shared.ts';

export const watchKey = (projectId: string) => ['watch', projectId] as const;
export const mappingsKey = ['watch', 'mappings'] as const;

/** Letöltés (mindig csatolmányként). */
export const fileUrl = (fileId: string) => `/api/watch/files/${fileId}/content`;

export const watchApi = {
  mappings: () => request<MappingList>('GET', '/api/watch/mappings'),
  project: (projectId: string) => request<ProjectWatch>('GET', `/api/watch/projects/${projectId}`),
  setMapping: (projectId: string, body: MappingSet) => request<ProjectWatch>('PUT', `/api/watch/projects/${projectId}/mapping`, body),
  deleteMapping: (projectId: string) => request<void>('DELETE', `/api/watch/projects/${projectId}/mapping`),
  scan: (projectId: string) => request<ScanResult>('POST', `/api/watch/projects/${projectId}/scan`),
  folders: (path: string) => request<FolderList>('GET', `/api/watch/folders?path=${encodeURIComponent(path)}`),
};
