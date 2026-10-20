import type { TimelineEvent } from '@derp/shared';
import { formatDateTime } from './format.ts';
import { t } from './i18n.ts';

/** Egyszerű eseménylista; az összecsukható idővonal a 3. munkacsomagban váltja ki. */
export function EventList({ events, timeZone }: { events: TimelineEvent[]; timeZone: string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t('events.empty')}</p>;
  return (
    <ol aria-label={t('events.title')} className="flex flex-col gap-3">
      {events.map((e) => (
        <li key={e.id} data-event-type={e.type} className="border-l-2 border-primary/30 pl-3">
          <p className="font-medium">{e.title}</p>
          <p className="text-sm text-muted-foreground">
            <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt, timeZone)}</time>
            {e.actor && <> · {e.actor.name}</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
