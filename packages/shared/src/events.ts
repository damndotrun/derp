import { z } from 'zod';

/** Eseménytípus: `<modul>.<esemény>`, pl. `core.project_created`. */
export const EventType = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

export const CORE_EVENTS = {
  projectCreated: 'core.project_created',
  projectUpdated: 'core.project_updated',
  projectDeleted: 'core.project_deleted',
} as const;

export const TimelineEvent = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  type: EventType,
  source: z.string(),
  occurredAt: z.iso.datetime({ offset: true }),
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  title: z.string(),
  data: z.record(z.string(), z.unknown()),
  parentId: z.uuid().nullable(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const EventList = z.object({ items: z.array(TimelineEvent) });
export type EventList = z.infer<typeof EventList>;

export const EventListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
