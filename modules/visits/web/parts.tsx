import { fill } from '@/core/i18n.ts';
import { cn } from '@/lib/utils';
import type { Visit, VisitStatus } from '../shared/schemas.ts';
import { timeRange } from './layout.ts';
import { t } from './i18n.ts';

const STATUS_CLASS: Record<VisitStatus, string> = {
  utemezett: 'bg-accent text-accent-foreground',
  folyamatban: 'bg-amber-100 text-amber-900',
  kesz: 'bg-emerald-100 text-emerald-900',
  elmaradt: 'bg-muted text-muted-foreground line-through',
};

export function StatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[status])}>
      {t(`visits.status.${status}`)}
    </span>
  );
}

/** Az ütközések felsorolása (ki, melyik projekt, mikor); a nem látható projekt neve nélkül. */
export function ConflictNote({ visit, timeZone }: { visit: Visit; timeZone: string }) {
  if (visit.conflicts.length === 0) return null;
  return (
    <ul aria-label={t('visits.conflict')} className="mt-1 flex flex-col gap-0.5 text-xs text-destructive">
      {visit.conflicts.map((c) => (
        <li key={`${c.visitId}-${c.userId}`}>
          {fill(t('visits.conflictWith'), {
            name: c.userName,
            project: c.projectName ?? t('visits.hiddenProject'),
            time: timeRange(c, timeZone, t('visits.overnight')),
          })}
        </li>
      ))}
    </ul>
  );
}

export function ConflictBadge() {
  return (
    <span className="inline-block rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-white">
      {t('visits.conflict')}
    </span>
  );
}
