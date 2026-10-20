import { desc, eq } from 'drizzle-orm';
import type { TimelineEvent } from '@derp/shared';
import type { Db } from './db.ts';
import { events, users } from './schema.ts';

export interface NewEvent {
  projectId: string | null;
  type: string;
  source: string;
  title: string;
  actorId?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: Date;
  parentId?: string | null;
}

/** Új esemény a közös eseménynaplóba (csak hozzáfűzés). Tranzakción belül is hívható. */
export async function appendEvent(db: Pick<Db, 'insert'>, e: NewEvent): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({
      projectId: e.projectId,
      type: e.type,
      source: e.source,
      title: e.title,
      actorId: e.actorId ?? null,
      data: e.data ?? {},
      parentId: e.parentId ?? null,
      ...(e.occurredAt ? { occurredAt: e.occurredAt } : {}),
    })
    .returning({ id: events.id });
  return row!.id;
}

export async function listProjectEvents(db: Db, projectId: string, limit: number): Promise<TimelineEvent[]> {
  const rows = await db
    .select({ event: events, actorName: users.name })
    .from(events)
    .leftJoin(users, eq(users.id, events.actorId))
    .where(eq(events.projectId, projectId))
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(limit);
  return rows.map(({ event, actorName }) => ({
    id: event.id,
    projectId: event.projectId,
    type: event.type,
    source: event.source,
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actorId ? { id: event.actorId, name: actorName ?? '' } : null,
    title: event.title,
    data: event.data,
    parentId: event.parentId,
  }));
}
