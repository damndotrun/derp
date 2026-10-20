import type {
  AuditList,
  AuditQuery,
  Client,
  ClientCreate,
  ClientDetail,
  ClientList,
  ClientUpdate,
  Contact,
  ContactCreate,
  ContactUpdate,
  EventList,
  ModuleList,
  Project,
  ProjectCreate,
  ProjectList,
  ProjectMemberList,
  ProjectUpdate,
  SessionInfo,
  User,
  UserCreate,
  UserList,
  UserRecord,
  UserUpdate,
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
  clientProjects: (clientId: string) => request<ProjectList>('GET', `/api/projects?clientId=${clientId}`),
  project: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  createProject: (body: ProjectCreate) => request<Project>('POST', '/api/projects', body),
  updateProject: (id: string, body: ProjectUpdate) => request<Project>('PATCH', `/api/projects/${id}`, body),
  deleteProject: (id: string) => request<void>('DELETE', `/api/projects/${id}`),
  projectEvents: (id: string) => request<EventList>('GET', `/api/projects/${id}/events`),
  projectMembers: (id: string) => request<ProjectMemberList>('GET', `/api/projects/${id}/members`),
  addMember: (id: string, userId: string) => request<void>('PUT', `/api/projects/${id}/members/${userId}`),
  removeMember: (id: string, userId: string) => request<void>('DELETE', `/api/projects/${id}/members/${userId}`),
  clients: () => request<ClientList>('GET', '/api/clients'),
  client: (id: string) => request<ClientDetail>('GET', `/api/clients/${id}`),
  createClient: (body: ClientCreate) => request<Client>('POST', '/api/clients', body),
  updateClient: (id: string, body: ClientUpdate) => request<Client>('PATCH', `/api/clients/${id}`, body),
  deleteClient: (id: string) => request<void>('DELETE', `/api/clients/${id}`),
  createContact: (clientId: string, body: ContactCreate) => request<Contact>('POST', `/api/clients/${clientId}/contacts`, body),
  updateContact: (id: string, body: ContactUpdate) => request<Contact>('PATCH', `/api/contacts/${id}`, body),
  deleteContact: (id: string) => request<void>('DELETE', `/api/contacts/${id}`),
  users: () => request<UserList>('GET', '/api/users'),
  createUser: (body: UserCreate) => request<UserRecord>('POST', '/api/users', body),
  updateUser: (id: string, body: UserUpdate) => request<UserRecord>('PATCH', `/api/users/${id}`, body),
  audit: (query: AuditQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    return request<AuditList>('GET', `/api/audit?${params}`);
  },
};
