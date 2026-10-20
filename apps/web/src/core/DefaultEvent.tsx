import type { ReactNode } from 'react';
import { formatDateTime } from './format.ts';
import type { EventRendererProps } from './module-types.ts';

/** Alapértelmezett eseménymegjelenítő: cím, helyi idő, szereplő. A modulok ezt saját tartalommal bővíthetik. */
export function DefaultEvent({ event, timeZone, children }: EventRendererProps & { children?: ReactNode }) {
  return (
    <>
      <p className="font-medium">{event.title}</p>
      <p className="text-sm text-muted-foreground">
        <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt, timeZone)}</time>
        {event.actor && <> · {event.actor.name}</>}
      </p>
      {children}
    </>
  );
}
