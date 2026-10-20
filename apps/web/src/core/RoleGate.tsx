import type { ReactNode } from 'react';
import type { Role } from '@derp/shared';
import { t } from './i18n.ts';
import { useUser } from './session.ts';

/** Csak a megadott szerepköröknek rendereli az oldalt; másnak „Nincs jogosultság” (a szerver úgyis 403-at adna). */
export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useUser();
  if (!user || !roles.includes(user.role)) return <p role="alert">{t('common.forbidden')}</p>;
  return children;
}
