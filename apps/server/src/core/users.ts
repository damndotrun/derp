import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UserCreate, UserList, UserRecord, UserUpdate } from '@derp/shared';
import { OFFICE_ROLES, requireRole } from './access.ts';
import { writeAudit } from './audit.ts';
import type { Db } from './db.ts';
import { conflict, notFound } from './errors.ts';
import { sessions, users } from './schema.ts';

type UserRow = typeof users.$inferSelect;

const toUserDto = (u: UserRow): UserRecord => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.deactivatedAt === null,
  version: u.version,
  createdAt: u.createdAt.toISOString(),
});

/** Egyedi kulcs megsértése (a Drizzle a pg-hibát `cause`-ként adja tovább). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

const IdParams = z.object({ id: z.uuid() });

export interface UserRoutesOptions {
  db: Db;
  /** A felhasználó szerepköre vagy állapota megváltozott: a nyitott eseményfolyamai záródjanak le (újra felépülnek). */
  onUserChanged: (userId: string) => void;
}

/**
 * Felhasználók kezelése. Belépni (Google vagy dev-login) csak az itt felvett, aktív e-mail-címmel lehet. A listát az
 * iroda is látja (projekthez rendeléshez); felvenni és módosítani csak az admin tud.
 */
export async function userRoutes(app: FastifyInstance, opts: UserRoutesOptions): Promise<void> {
  const { db, onUserChanged } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = requireRole('admin');

  r.get('/api/users', { preHandler: requireRole(...OFFICE_ROLES), schema: { response: { 200: UserList } } }, async () => {
    const rows = await db.select().from(users).orderBy(asc(users.name));
    return { items: rows.map(toUserDto) };
  });

  r.post('/api/users', { preHandler: admin, schema: { body: UserCreate, response: { 201: UserRecord } } }, async (req, reply) => {
    try {
      const row = await db.transaction(async (tx) => {
        const [u] = await tx.insert(users).values(req.body).returning();
        await writeAudit(tx, {
          userId: req.user!.id,
          action: 'create',
          entityType: 'user',
          entityId: u!.id,
          label: u!.name,
          data: { email: u!.email, role: u!.role },
        });
        return u!;
      });
      return reply.code(201).send(toUserDto(row));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Ezzel az e-mail-címmel már van felhasználó');
      throw err;
    }
  });

  r.patch(
    '/api/users/:id',
    { preHandler: admin, schema: { params: IdParams, body: UserUpdate, response: { 200: UserRecord } } },
    async (req) => {
      const { version, active, ...fields } = req.body;
      const self = req.params.id === req.user!.id;
      try {
        const { row, changed } = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(users).where(eq(users.id, req.params.id)).for('update');
          if (!current) throw notFound('A felhasználó nem található');
          if (current.version !== version) throw conflict('A felhasználót közben más módosította; töltsd újra az oldalt');
          const changes: Record<string, { from: unknown; to: unknown }> = {};
          for (const key of ['email', 'name', 'role'] as const) {
            const to = fields[key];
            if (to !== undefined && to !== current[key]) changes[key] = { from: current[key], to };
          }
          const wasActive = current.deactivatedAt === null;
          if (active !== undefined && active !== wasActive) changes.active = { from: wasActive, to: active };
          // Az admin ne zárhassa ki magát (és ne maradhasson admin nélkül a rendszer).
          if (self && (changes.role || changes.active)) {
            throw conflict('A saját szerepkörödet és állapotodat másik adminnak kell módosítania');
          }
          if (Object.keys(changes).length === 0) return { row: current, changed: false };
          const [row] = await tx
            .update(users)
            .set({
              ...fields,
              ...(changes.active ? { deactivatedAt: active ? null : sql`now()` } : {}),
              version: current.version + 1,
            })
            .where(eq(users.id, current.id))
            .returning();
          // Kikapcsoláskor a munkamenetek is megszűnnek.
          if (changes.active && !active) await tx.delete(sessions).where(eq(sessions.userId, current.id));
          await writeAudit(tx, {
            userId: req.user!.id,
            action: 'update',
            entityType: 'user',
            entityId: current.id,
            label: row!.name,
            data: { changes },
          });
          return { row: row!, changed: !!(changes.role || changes.active) };
        });
        if (changed) onUserChanged(row.id);
        return toUserDto(row);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('Ezzel az e-mail-címmel már van felhasználó');
        throw err;
      }
    },
  );
}
