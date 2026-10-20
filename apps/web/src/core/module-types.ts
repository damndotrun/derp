// A modulok kliens oldali felülete (csak típusok, hogy a modulok importja ne hozzon körkörös függést a regiszterrel).
import type { ComponentType } from 'react';
import type { TimelineEvent } from '@derp/shared';

export interface EventRendererProps {
  event: TimelineEvent;
  timeZone: string;
}
export type EventRenderer = ComponentType<EventRendererProps>;

export interface ModuleRoute {
  /** Kliens oldali útvonal, pl. `/example` vagy `/example/:id`. */
  path: string;
  Component: ComponentType;
}

/**
 * Egy modul kliens oldali része (`modules/<id>/web/index.ts`, alapértelmezett export). A menüpontot és az
 * eseménytípusokat a szerver oldali manifest adja (`GET /api/modules`); ez az oldalakat, az eseménytípusonkénti
 * idővonal-megjelenítőt és a szövegeket hozza.
 */
export interface WebModule {
  id: string;
  /** A `modules/<id>/web/i18n.ts` szövegei; minden kulcs `<id>.` előtagú. */
  messages: Record<string, string>;
  routes?: ModuleRoute[];
  /** Eseménytípus (`<id>.<esemény>`) → megjelenítő; ami nincs itt, az alapértelmezett megjelenítővel látszik. */
  eventRenderers?: Record<string, EventRenderer>;
}
