import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

export const sessionKey = ['session'] as const;

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: api.session, staleTime: 60_000 });
}
