import { useQuery } from '@tanstack/react-query';
import type { User } from '@derp/shared';
import { api } from './api.ts';

export const sessionKey = ['session'] as const;

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: api.session, staleTime: 60_000 });
}

/** Az irodai szerepkörök (admin, iroda) minden projektet látnak és kezelnek; a terepes csak a hozzá rendelteket látja. */
export const isOffice = (user: User | null | undefined): boolean => user?.role === 'admin' || user?.role === 'iroda';
export const isAdmin = (user: User | null | undefined): boolean => user?.role === 'admin';

/** A bejelentkezett felhasználó (a `Layout` alatt mindig van). */
export function useUser(): User | null {
  return useSession().data?.user ?? null;
}
