import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';
import type { VisitEventData } from '../shared/schemas.ts';
import { localDate } from '../shared/time.ts';
import { t } from './i18n.ts';
import { longDayLabel, timeRange } from './layout.ts';

/** A kiszállás-események (ütemezve, módosítva, törölve) megjelenítője: mikor, kik, hol, mi a feladat. */
export function VisitEvent(props: EventRendererProps) {
  const d = props.event.data as Partial<VisitEventData>;
  if (!d.startsAt || !d.endsAt) return <DefaultEvent {...props} />;
  const when = `${longDayLabel(localDate(d.startsAt, props.timeZone))} ${timeRange(
    { startsAt: d.startsAt, endsAt: d.endsAt },
    props.timeZone,
    t('visits.overnight'),
  )}`;
  return (
    <DefaultEvent {...props}>
      <div className="mt-1 rounded-md bg-accent px-2 py-1 text-sm">
        <p className="font-medium">{when}</p>
        {d.assignees && d.assignees.length > 0 && <p>{d.assignees.map((a) => a.name).join(', ')}</p>}
        {d.address && <p>{d.address}</p>}
        {d.task && <p className="whitespace-pre-line text-muted-foreground">{d.task}</p>}
        {d.status && d.status !== 'utemezett' && <p>{t(`visits.status.${d.status}`)}</p>}
      </div>
    </DefaultEvent>
  );
}
