import { cn } from '@/lib/utils';
import type { QuoteStatus } from '../shared/schemas.ts';
import { t } from './i18n.ts';

const STYLE: Record<QuoteStatus, string> = {
  tervezet: 'border-amber-300 bg-amber-50 text-amber-900',
  kikuldve: 'border-sky-300 bg-sky-50 text-sky-900',
  elfogadva: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  elutasitva: 'border-rose-300 bg-rose-50 text-rose-900',
};

/** Az ajánlat(verzió) kézi státusza. */
export function StatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', STYLE[status], className)}>{t(`quotes.status.${status}`)}</span>;
}
