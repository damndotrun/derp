import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { t as coreT } from '@/core/i18n.ts';
import { useSession } from '@/core/session.ts';
import { addDays, localDate } from '../shared/time.ts';
import { useLiveVisits, visitsApi, visitsKey } from './api.ts';
import { t } from './i18n.ts';
import { longDayLabel, timeRange } from './layout.ts';
import { ConflictBadge, ConflictNote, StatusBadge } from './parts.tsx';

/**
 * „Mai kiszállásaim” a telefonon: a bejelentkezett kolléga kiszállásai egy napon (`GET /api/visits/mine?date=`).
 * A nap alapból a mai (TZ_DISPLAY szerint); a `?date=YYYY-MM-DD` és a lapozó gombok más napot mutatnak.
 */
export function MinePage() {
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? undefined;
  const mine = useQuery({ queryKey: [...visitsKey, 'mine', date ?? 'today'], queryFn: () => visitsApi.mine(date) });
  useLiveVisits();
  const shown = mine.data?.date ?? date ?? localDate(new Date(), tz);
  const go = (d: string) => setParams(d === localDate(new Date(), tz) ? {} : { date: d });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('visits.mineTitle')}</h1>
        <p className="text-sm text-muted-foreground">{longDayLabel(shown)}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => go(addDays(shown, -1))}>
          ‹ {t('visits.prevDay')}
        </Button>
        {date && (
          <Button size="sm" variant="outline" onClick={() => setParams({})}>
            {t('visits.today')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => go(addDays(shown, 1))}>
          {t('visits.nextDay')} ›
        </Button>
      </div>

      {mine.isPending && <p>{coreT('common.loading')}</p>}
      {mine.isError && <p className="text-destructive">{mine.error.message}</p>}
      {mine.data?.items.length === 0 && <p className="text-muted-foreground">{t('visits.mineEmpty')}</p>}
      <ul aria-label={t('visits.mineTitle')} className="flex flex-col gap-3">
        {mine.data?.items.map((v) => (
          <li key={v.id}>
            <Card className={v.status === 'elmaradt' ? 'opacity-60' : undefined}>
              <CardContent className="flex flex-col gap-1 pt-4 sm:pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">{timeRange(v, tz, t('visits.overnight'))}</span>
                  <StatusBadge status={v.status} />
                  {v.conflicts.length > 0 && <ConflictBadge visit={v} timeZone={tz} />}
                </div>
                <Link to={`/projects/${v.projectId}`} className="font-medium underline-offset-2 hover:underline">
                  {v.projectName}
                </Link>
                {v.clientName && <p className="text-sm text-muted-foreground">{v.clientName}</p>}
                {v.address && <p className="text-sm">{v.address}</p>}
                {v.task && <p className="whitespace-pre-line text-sm">{v.task}</p>}
                <p className="text-xs text-muted-foreground">
                  {t('visits.assignees')}: {v.assignees.map((a) => a.name).join(', ')}
                </p>
                <ConflictNote visit={v} timeZone={tz} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
