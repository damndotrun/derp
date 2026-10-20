import { and, desc, eq, gt, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AuditList, AuditQuery, type AuditAction, type AuditEntry } from '@derp/shared';
import { requireRole } from './access.ts';
import type { Db } from './db.ts';
import { auditLog, users } from './schema.ts';

export interface NewAuditEntry {
  userId: string | null;
  action: AuditAction;
  /** A mag entitásai: `user`, `client`, `contact`, `project`; modul: `<modul>.<entitás>`. */
  entityType: string;
  entityId: string;
  label?: string;
  projectId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Ugyanannak a felhasználónak ugyanarra az entitásra eső megtekintéseiből ennyi időn belül csak az első kerül a
 * naplóba: a felület újratöltései (fókusz, élő frissítés) ne árasszák el.
 */
export const VIEW_DEDUP_SECONDS = 60;

/** Bejegyzés az auditnaplóba (csak hozzáfűzés). Tranzakción belül is hívható. */
export async function writeAudit(db: Pick<Db, 'insert'>, e: NewAuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    userId: e.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    label: e.label ?? '',
    projectId: e.projectId ?? null,
    data: e.data ?? {},
  });
}

/** Megtekintés naplózása; `VIEW_DEDUP_SECONDS`-on belüli ismétlést nem ír újra. */
export async function recordView(db: Db, e: Omit<NewAuditEntry, 'action'>): Promise<void> {
  const [recent] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, e.entityType),
        eq(auditLog.entityId, e.entityId),
        eq(auditLog.action, 'view'),
        e.userId ? eq(auditLog.userId, e.userId) : sql`${auditLog.userId} IS NULL`,
        gt(auditLog.at, sql`now() - make_interval(secs => ${VIEW_DEDUP_SECONDS})`),
      ),
    )
    .limit(1);
  if (!recent) await writeAudit(db, { ...e, action: 'view' });
}

/** `GET /api/audit`: az auditnapló, legújabb elöl, szűrőkkel és lapozással (`before`). Csak adminnak. */
export async function auditRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/audit',
    { preHandler: requireRole('admin'), schema: { querystring: AuditQuery, response: { 200: AuditList } } },
    async (req) => {
      const q = req.query;
      const where: SQL[] = [];
      if (q.userId) where.push(eq(auditLog.userId, q.userId));
      if (q.entityType) where.push(eq(auditLog.entityType, q.entityType));
      if (q.entityId) where.push(eq(auditLog.entityId, q.entityId));
      if (q.projectId) where.push(eq(auditLog.projectId, q.projectId));
      if (q.action) where.push(eq(auditLog.action, q.action));
      if (q.before) where.push(lt(auditLog.id, q.before));
      const rows = await db
        .select({ entry: auditLog, userName: users.name })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(...where))
        .orderBy(desc(auditLog.id))
        .limit(q.limit + 1);
      const items: AuditEntry[] = rows.slice(0, q.limit).map(({ entry, userName }) => ({
        id: entry.id,
        at: entry.at.toISOString(),
        user: entry.userId ? { id: entry.userId, name: userName ?? '' } : null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        label: entry.label,
        projectId: entry.projectId,
        data: entry.data,
      }));
      return { items, nextBefore: rows.length > q.limit ? items.at(-1)!.id : null };
    },
  );
}
