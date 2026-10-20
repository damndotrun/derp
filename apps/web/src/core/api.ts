import type {
  EventList,
  ModuleList,
  Project,
  ProjectCreate,
  ProjectList,
  ProjectUpdate,
  SessionInfo,
  User,
} from '@derp/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, payload?.error?.code ?? 'http', payload?.error?.message ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  session: () => request<SessionInfo>('GET', '/api/session'),
  devLogin: (email: string) => request<{ user: User }>('POST', '/api/dev-login', { email }),
  logout: () => request<void>('POST', '/api/logout'),
  modules: () => request<ModuleList>('GET', '/api/modules'),
  projects: () => request<ProjectList>('GET', '/api/projects'),
  project: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  createProject: (body: ProjectCreate) => request<Project>('POST', '/api/projects', body),
  updateProject: (id: string, body: ProjectUpdate) => request<Project>('PATCH', `/api/projects/${id}`, body),
  deleteProject: (id: string) => request<void>('DELETE', `/api/projects/${id}`),
  projectEvents: (id: string) => request<EventList>('GET', `/api/projects/${id}/events`),
};
