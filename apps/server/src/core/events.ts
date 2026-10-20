import { and, asc, count, desc, eq, gt, inArray, max, sql, type SQL } from 'drizzle-orm';
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

export interface ProjectEventsQuery {
  limit: number;
  /** Az ennél az eseménynél régebbiek (lapozás). */
  before?: string;
  /** Csak ezek a típusok; üres = mind. */
  types?: string[];
}

/**
 * Egy projekt eseményei időpont, majd azonosító szerint csökkenő sorrendben, kurzoros lapozással. A kurzor egy
 * esemény azonosítója: a folytatás az adatbázisban tárolt (mikroszekundumos) időpontjához mér, így az azonos
 * ezredmásodpercben történt események sem vesznek el a lapok határán.
 */
export async function listProjectEvents(
  db: Db,
  projectId: string,
  { limit, before, types = [] }: ProjectEventsQuery,
): Promise<{ items: TimelineEvent[]; nextCursor: string | null }> {
  const where: SQL[] = [eq(events.projectId, projectId)];
  if (types.length > 0) where.push(inArray(events.type, types));
  if (before) {
    where.push(
      sql`(${events.occurredAt}, ${events.id}) < (SELECT c.occurred_at, c.id FROM events c WHERE c.id = ${before} AND c.project_id = ${projectId})`,
    );
  }
  const rows = await withActor(db)
    .where(and(...where))
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map(toTimelineEvent);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}

/** A projekt idővonalán előforduló eseménytípusok és darabszámuk. */
export async function projectEventTypes(db: Db, projectId: string): Promise<Array<{ type: string; count: number }>> {
  return db
    .select({ type: events.type, count: count() })
    .from(events)
    .where(eq(events.projectId, projectId))
    .groupBy(events.type)
    .orderBy(asc(events.type));
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
