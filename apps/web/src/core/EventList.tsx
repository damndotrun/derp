import type { TimelineEvent } from '@derp/shared';
import { DefaultEvent } from './DefaultEvent.tsx';
import { t } from './i18n.ts';
import type { EventRenderer } from './module-types.ts';
import { registry } from './modules.ts';

/**
 * Egyszerű eseménylista; az összecsukható idővonal a 3. munkacsomagban váltja ki. Az eseménytípus megjelenítőjét a
 * modul adja (`eventRenderers`), ha nincs, az alapértelmezett jelenik meg.
 */
export function EventList({
  events,
  timeZone,
  renderers = registry.eventRenderers,
}: {
  events: TimelineEvent[];
  timeZone: string;
  renderers?: Record<string, EventRenderer>;
}) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t('events.empty')}</p>;
  return (
    <ol aria-label={t('events.title')} className="flex flex-col gap-3">
      {events.map((e) => {
        const Renderer = renderers[e.type] ?? DefaultEvent;
        return (
          <li key={e.id} data-event-type={e.type} className="border-l-2 border-primary/30 pl-3">
            <Renderer event={e} timeZone={timeZone} />
          </li>
        );
      })}
    </ol>
  );
}
