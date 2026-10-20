import { asc, desc, eq, gt, max } from 'drizzle-orm';
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

type EventRow = typeof events.$inferSelect;

const toTimelineEvent = ({ event, actorName }: { event: EventRow; actorName: string | null }): TimelineEvent => ({
  id: event.id,
  projectId: event.projectId,
  type: event.type,
  source: event.source,
  occurredAt: event.occurredAt.toISOString(),
  actor: event.actorId ? { id: event.actorId, name: actorName ?? '' } : null,
  title: event.title,
  data: event.data,
  parentId: event.parentId,
});

const withActor = (db: Db) =>
  db.select({ event: events, actorName: users.name }).from(events).leftJoin(users, eq(users.id, events.actorId));

export async function listProjectEvents(db: Db, projectId: string, limit: number): Promise<TimelineEvent[]> {
  const rows = await withActor(db)
    .where(eq(events.projectId, projectId))
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(limit);
  return rows.map(toTimelineEvent);
}

/** Esemény a sorszámával (az SSE-folyamhoz). */
export interface SequencedEvent {
  seq: number;
  event: TimelineEvent;
}

const toSequenced = (row: { event: EventRow; actorName: string | null }): SequencedEvent => ({
  seq: row.event.seq,
  event: toTimelineEvent(row),
});

export async function eventBySeq(db: Db, seq: number): Promise<SequencedEvent | null> {
  const [row] = await withActor(db).where(eq(events.seq, seq)).limit(1);
  return row ? toSequenced(row) : null;
}

/** A `seq` utáni események beszúrási sorrendben (a `Last-Event-ID` szerinti folytatáshoz). */
export async function eventsAfter(db: Db, seq: number, limit: number): Promise<SequencedEvent[]> {
  const rows = await withActor(db).where(gt(events.seq, seq)).orderBy(asc(events.seq)).limit(limit);
  return rows.map(toSequenced);
}

export async function lastEventSeq(db: Db): Promise<number> {
  const [row] = await db.select({ seq: max(events.seq) }).from(events);
  return row?.seq ?? 0;
}
