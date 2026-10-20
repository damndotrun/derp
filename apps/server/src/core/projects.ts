import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CORE_EVENTS,
  EventList,
  EventListQuery,
  Project,
  ProjectCreate,
  ProjectList,
  ProjectUpdate,
} from '@derp/shared';
import type { Db } from './db.ts';
import { conflict, notFound } from './errors.ts';
import { appendEvent, listProjectEvents } from './events.ts';
import { projects } from './schema.ts';

type ProjectRow = typeof projects.$inferSelect;

export const toProjectDto = (p: ProjectRow): Project => ({
  id: p.id,
  name: p.name,
  clientName: p.clientName,
  version: p.version,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const IdParams = z.object({ id: z.uuid() });
const active = (id: string) => and(eq(projects.id, id), isNull(projects.deletedAt));

export async function getActiveProject(db: Db, id: string): Promise<ProjectRow> {
  const [row] = await db.select().from(projects).where(active(id)).limit(1);
  if (!row) throw notFound('A projekt nem található');
  return row;
}

export async function projectRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/projects', { schema: { response: { 200: ProjectList } } }, async () => {
    const rows = await db.select().from(projects).where(isNull(projects.deletedAt)).orderBy(desc(projects.createdAt));
    return { items: rows.map(toProjectDto) };
  });

  r.post('/api/projects', { schema: { body: ProjectCreate, response: { 201: Project } } }, async (req, reply) => {
    const project = await db.transaction(async (tx) => {
      const [row] = await tx.insert(projects).values(req.body).returning();
      await appendEvent(tx, {
        projectId: row!.id,
        type: CORE_EVENTS.projectCreated,
        source: 'user',
        title: 'Projekt létrehozva',
        actorId: req.user!.id,
        data: { name: row!.name, clientName: row!.clientName },
      });
      return row!;
    });
    return reply.code(201).send(toProjectDto(project));
  });

  r.get('/api/projects/:id', { schema: { params: IdParams, response: { 200: Project } } }, async (req) =>
    toProjectDto(await getActiveProject(db, req.params.id)),
  );

  r.patch(
    '/api/projects/:id',
    { schema: { params: IdParams, body: ProjectUpdate, response: { 200: Project } } },
    async (req) => {
      const { version, ...fields } = req.body;
      return toProjectDto(
        await db.transaction(async (tx) => {
          const [current] = await tx.select().from(projects).where(active(req.params.id)).for('update');
          if (!current) throw notFound('A projekt nem található');
          if (current.version !== version) {
            throw conflict('A projektet közben más módosította; töltsd újra az adatlapot');
          }
          const changes: Record<string, { from: string; to: string }> = {};
          for (const key of ['name', 'clientName'] as const) {
            const to = fields[key];
            if (to !== undefined && to !== current[key]) changes[key] = { from: current[key], to };
          }
          if (Object.keys(changes).length === 0) return current;
          const [row] = await tx
            .update(projects)
            .set({ ...fields, version: current.version + 1, updatedAt: new Date() })
            .where(eq(projects.id, current.id))
            .returning();
          await appendEvent(tx, {
            projectId: current.id,
            type: CORE_EVENTS.projectUpdated,
            source: 'user',
            title: 'Projekt módosítva',
            actorId: req.user!.id,
            data: { changes },
          });
          return row!;
        }),
      );
    },
  );

  // Törléskor a projekt rejtett lesz (deleted_at); az eseménynapló csak hozzáfűzhető, így megmarad.
  r.delete('/api/projects/:id', { schema: { params: IdParams } }, async (req, reply) => {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({ deletedAt: new Date() })
        .where(active(req.params.id))
        .returning();
      if (!row) throw notFound('A projekt nem található');
      await appendEvent(tx, {
        projectId: row.id,
        type: CORE_EVENTS.projectDeleted,
        source: 'user',
        title: 'Projekt törölve',
        actorId: req.user!.id,
        data: { name: row.name },
      });
    });
    return reply.code(204).send();
  });

  r.get(
    '/api/projects/:id/events',
    { schema: { params: IdParams, querystring: EventListQuery, response: { 200: EventList } } },
    async (req) => {
      await getActiveProject(db, req.params.id);
      return { items: await listProjectEvents(db, req.params.id, req.query.limit) };
    },
  );
}
