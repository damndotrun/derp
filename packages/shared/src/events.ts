import { z } from 'zod';

/** Eseménytípus: `<modul>.<esemény>`, pl. `core.project_created`. */
export const EventType = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

export const CORE_EVENTS = {
  projectCreated: 'core.project_created',
  projectUpdated: 'core.project_updated',
  projectDeleted: 'core.project_deleted',
  /** Kolléga hozzárendelve a projekthez (`data.userId`); a terepes ettől látja a projektet. */
  memberAdded: 'core.member_added',
  memberRemoved: 'core.member_removed',
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

/** Az idővonal egy lapja; a `nextCursor` a következő (régebbi) lap `before` paramétere, `null`, ha nincs több. */
export const EventList = z.object({ items: z.array(TimelineEvent), nextCursor: z.uuid().nullable() });
export type EventList = z.infer<typeof EventList>;

export const EventListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Lapozás: az ennél az eseménynél régebbiek (időpont, majd azonosító szerint csökkenő sorrendben). */
  before: z.uuid().optional(),
  /** Szűrés eseménytípusokra, vesszővel elválasztva; üres vagy hiányzó = mind. */
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(EventType).max(100)),
});

/** A projekt idővonalán előforduló eseménytípusok darabszámmal (a típusszűrő választéka). */
export const EventTypeCounts = z.object({ items: z.array(z.object({ type: EventType, count: z.number().int() })) });
export type EventTypeCounts = z.infer<typeof EventTypeCounts>;

/** Teszt-végpont (`NODE_ENV=test`): események tetszőleges időponttal az idővonal e2e-tesztjeihez. */
export const TestEventsCreate = z.object({
  projectId: z.uuid(),
  events: z
    .array(
      z.object({
        type: EventType,
        title: z.string().min(1).max(200),
        occurredAt: z.iso.datetime({ offset: true }).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        parentId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type TestEventsCreate = z.infer<typeof TestEventsCreate>;
