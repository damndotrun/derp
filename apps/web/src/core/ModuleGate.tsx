import type { ReactNode } from 'react';
import { t } from './i18n.ts';
import { useModules } from './modules.ts';

/** Csak akkor rendereli a modul oldalát, ha a modul be van kapcsolva (`GET /api/modules`). */
export function ModuleGate({ moduleId, children }: { moduleId: string; children: ReactNode }) {
  const modules = useModules();
  if (modules.isPending) return <p>{t('common.loading')}</p>;
  if (modules.isError) return <p className="text-destructive">{modules.error.message}</p>;
  if (!modules.data.items.some((m) => m.id === moduleId)) return <p className="text-muted-foreground">{t('modules.disabled')}</p>;
  return children;
}
