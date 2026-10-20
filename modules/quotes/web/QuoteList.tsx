import { Link } from 'react-router';
import { formatDateTime } from '@/core/format.ts';
import { fill } from '@/core/i18n.ts';
import { formatFiller, quoteRef } from '../shared/format.ts';
import type { QuoteSummary } from '../shared/schemas.ts';
import { t } from './i18n.ts';
import { StatusBadge } from './StatusBadge.tsx';

/** Ajánlatok listája a legújabb verziójukkal (ha `withProject`, a projekt és az ügyfél is látszik). */
export function QuoteList({ items, timeZone, withProject }: { items: QuoteSummary[]; timeZone: string; withProject?: boolean }) {
  return (
    <ul aria-label={t('quotes.list')} className="divide-y">
      {items.map((q) => (
        <li key={q.id}>
          <Link to={`/quotes/${q.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-accent">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {fill(t('quotes.quoteTitle'), { ref: quoteRef(q.number, q.versionNo) })}
                <StatusBadge status={q.status} />
              </span>
              {withProject && (
                <span className="block truncate text-sm text-muted-foreground">
                  {q.projectName}
                  {q.clientName && ` · ${q.clientName}`}
                </span>
              )}
              <span className="block text-xs text-muted-foreground">
                {fill(t('quotes.itemCount'), { n: q.itemCount })} · {t('quotes.updatedAt')}: {formatDateTime(q.updatedAt, timeZone)}
              </span>
            </span>
            <span className="whitespace-nowrap font-semibold tabular-nums">{formatFiller(q.totalFiller)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
