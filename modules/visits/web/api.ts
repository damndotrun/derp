import { useQueryClient } from '@tanstack/react-query';
import { request } from '@/core/api.ts';
import { useLiveEvents } from '@/core/stream.ts';
import type {
  IcsTokenCreated,
  IcsTokenInfo,
  MineResponse,
  Visit,
  VisitCreate,
  VisitList,
  VisitUpdate,
} from '../shared/schemas.ts';

export const visitsKey = ['visits'] as const;

export const visitsApi = {
  list: (q: { from: string; to: string; userId?: string }) => {
    const params = new URLSearchParams({ from: q.from, to: q.to });
    if (q.userId) params.set('userId', q.userId);
    return request<VisitList>('GET', `/api/visits?${params}`);
  },
  mine: (date?: string) => request<MineResponse>('GET', `/api/visits/mine${date ? `?date=${date}` : ''}`),
  create: (body: VisitCreate) => request<Visit>('POST', '/api/visits', body),
  update: (id: string, body: VisitUpdate) => request<Visit>('PATCH', `/api/visits/${id}`, body),
  remove: (id: string) => request<void>('DELETE', `/api/visits/${id}`),
  icsToken: () => request<IcsTokenInfo>('GET', '/api/visits/ics-token'),
  createIcsToken: () => request<IcsTokenCreated>('POST', '/api/visits/ics-token'),
};

/** Kiszállás-esemény (bárki módosította) vagy hozzárendelés-változás esetén a kiszállás-nézetek újratöltődnek. */
export function useLiveVisits(): void {
  const queryClient = useQueryClient();
  useLiveEvents((e) => {
    if (e.type.startsWith('visits.') || e.type === 'core.member_added' || e.type === 'core.member_removed') {
      void queryClient.invalidateQueries({ queryKey: visitsKey });
    }
  });
}
