import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CORE_EVENTS,
  EventList,
  EventListQuery,
  EventTypeCounts,
  Project,
  ProjectCreate,
  ProjectList,
  ProjectListQuery,
  ProjectMemberList,
  ProjectUpdate,
  type ClientRef,
  type User,
} from '@derp/shared';
import { isProjectMember, OFFICE_ROLES, requireRole, seesAllProjects, visibleProjectsWhere } from './access.ts';
import { recordView, writeAudit } from './audit.ts';
import type { Db } from './db.ts';
import { badRequest, conflict, forbidden, notFound } from './errors.ts';
import { appendEvent, listProjectEvents, projectEventTypes } from './events.ts';
import { clients, projectMembers, projects, users } from './schema.ts';

type ProjectRow = typeof projects.$inferSelect;
export interface ProjectWithClient {
  project: ProjectRow;
  client: ClientRef | null;
}

export const toProjectDto = ({ project: p, client }: ProjectWithClient): Project => ({
  id: p.id,
  name: p.name,
  client,
  version: p.version,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

const IdParams = z.object({ id: z.uuid() });
const MemberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const active = (id: string) => and(eq(projects.id, id), isNull(projects.deletedAt));

const selectWithClient = (db: Db) =>
  db
    .select({ project: projects, clientId: clients.id, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId));

const withClient = (r: { project: ProjectRow; clientId: string | null; clientName: string | null }): ProjectWithClient => ({
  project: r.project,
  client: r.clientId ? { id: r.clientId, name: r.clientName ?? '' } : null,
});

export async function getActiveProject(db: Db, id: string): Promise<ProjectWithClient> {
  const [row] = await selectWithClient(db).where(active(id)).limit(1);
  if (!row) throw notFound('A projekt nem található');
  return withClient(row);
}

/**
 * A projekt, ha létezik és a felhasználó láthatja. Nem létező vagy törölt projektre 404; ha létezik, de a terepes
 * felhasználó nincs hozzárendelve, 403.
 */
export async function getVisibleProject(db: Db, user: User, id: string): Promise<ProjectWithClient> {
  const p = await getActiveProject(db, id);
  if (!seesAllProjects(user) && !(await isProjectMember(db, id, user.id))) {
    throw forbidden('Nincs jogosultságod ehhez a projekthez');
  }
  return p;
}

/** Az ügyfél nevével; ismeretlen vagy törölt ügyfélre 400. */
async function activeClientRef(db: Pick<Db, 'select'>, clientId: string | null): Promise<ClientRef | null> {
  if (!clientId) return null;
  const [row] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!row) throw badRequest('Ismeretlen ügyfél');
  return row;
}

export async function projectRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const office = requireRole(...OFFICE_ROLES);

  r.get('/api/projects', { schema: { querystring: ProjectListQuery, response: { 200: ProjectList } } }, async (req) => {
    const rows = await selectWithClient(db)
      .where(
        and(
          isNull(projects.deletedAt),
          req.query.clientId ? eq(projects.clientId, req.query.clientId) : undefined,
          visibleProjectsWhere(req.user!),
        ),
      )
      .orderBy(desc(projects.createdAt));
    return { items: rows.map((row) => toProjectDto(withClient(row))) };
  });

  r.post(
    '/api/projects',
    { preHandler: office, schema: { body: ProjectCreate, response: { 201: Project } } },
    async (req, reply) => {
      const project = await db.transaction(async (tx) => {
        const client = await activeClientRef(tx, req.body.clientId);
        const [row] = await tx.insert(projects).values({ name: req.body.name, clientId: client?.id ?? null }).returning();
        await appendEvent(tx, {
          projectId: row!.id,
          type: CORE_EVENTS.projectCreated,
          source: 'user',
          title: 'Projekt létrehozva',
          actorId: req.user!.id,
          data: { name: row!.name, client },
        });
        await writeAudit(tx, {
          userId: req.user!.id,
          action: 'create',
          entityType: 'project',
          entityId: row!.id,
          label: row!.name,
          projectId: row!.id,
        });
        return { project: row!, client };
      });
      return reply.code(201).send(toProjectDto(project));
    },
  );

  r.get('/api/projects/:id', { schema: { params: IdParams, response: { 200: Project } } }, async (req) => {
    const p = await getVisibleProject(db, req.user!, req.params.id);
    await recordView(db, { userId: req.user!.id, entityType: 'project', entityId: p.project.id, label: p.project.name, projectId: p.project.id });
    return toProjectDto(p);
  });

  r.patch(
    '/api/projects/:id',
    { preHandler: office, schema: { params: IdParams, body: ProjectUpdate, response: { 200: Project } } },
    async (req) => {
      const { version, name, clientId } = req.body;
      return toProjectDto(
        await db.transaction(async (tx) => {
          const [current] = await tx.select().from(projects).where(active(req.params.id)).for('update');
          if (!current) throw notFound('A projekt nem található');
          if (current.version !== version) {
            throw conflict('A projektet közben más módosította; töltsd újra az adatlapot');
          }
          const [currentClient] = current.clientId
            ? await tx.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, current.clientId))
            : [];
          const changes: Record<string, { from: string; to: string }> = {};
          if (name !== undefined && name !== current.name) changes.name = { from: current.name, to: name };
          let client: ClientRef | null = currentClient ?? null;
          if (clientId !== undefined && clientId !== current.clientId) {
            client = await activeClientRef(tx, clientId);
            changes.client = { from: currentClient?.name ?? '', to: client?.name ?? '' };
          }
          if (Object.keys(changes).length === 0) return { project: current, client };
          const [row] = await tx
            .update(projects)
            .set({ name: name ?? current.name, clientId: client?.id ?? null, version: current.version + 1, updatedAt: new Date() })
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
          await writeAudit(tx, {
            userId: req.user!.id,
            action: 'update',
            entityType: 'project',
            entityId: current.id,
            label: row!.name,
            projectId: current.id,
            data: { changes },
          });
          return { project: row!, client };
        }),
      );
    },
  );

  // Törléskor a projekt rejtett lesz (deleted_at); az eseménynapló csak hozzáfűzhető, így megmarad.
  r.delete('/api/projects/:id', { preHandler: office, schema: { params: IdParams } }, async (req, reply) => {
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
      await writeAudit(tx, {
        userId: req.user!.id,
        action: 'delete',
        entityType: 'project',
        entityId: row.id,
        label: row.name,
        projectId: row.id,
      });
    });
    return reply.code(204).send();
  });

  r.get(
    '/api/projects/:id/events',
    { schema: { params: IdParams, querystring: EventListQuery, response: { 200: EventList } } },
    async (req) => {
      await getVisibleProject(db, req.user!, req.params.id);
      return listProjectEvents(db, req.params.id, req.query);
    },
  );

  r.get(
    '/api/projects/:id/event-types',
    { schema: { params: IdParams, response: { 200: EventTypeCounts } } },
    async (req) => {
      await getVisibleProject(db, req.user!, req.params.id);
      return { items: await projectEventTypes(db, req.params.id) };
    },
  );

  r.get(
    '/api/projects/:id/members',
    { schema: { params: IdParams, response: { 200: ProjectMemberList } } },
    async (req) => {
      await getVisibleProject(db, req.user!, req.params.id);
      const items = await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, req.params.id))
        .orderBy(asc(users.name));
      return { items };
    },
  );

  // Hozzárendelés: idempotens (már hozzárendelt kollégánál nincs új esemény). Az esemény `data.userId`-ja alapján
  // frissül a terepes felhasználó SSE-folyamának láthatósága is.
  r.put('/api/projects/:id/members/:userId', { preHandler: office, schema: { params: MemberParams } }, async (req, reply) => {
    await db.transaction(async (tx) => {
      const [project] = await tx.select().from(projects).where(active(req.params.id)).for('update');
      if (!project) throw notFound('A projekt nem található');
      const [member] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.id, req.params.userId), isNull(users.deactivatedAt)));
      if (!member) throw badRequest('Ismeretlen vagy kikapcsolt felhasználó');
      const inserted = await tx
        .insert(projectMembers)
        .values({ projectId: project.id, userId: member.id })
        .onConflictDoNothing()
        .returning({ userId: projectMembers.userId });
      if (inserted.length === 0) return;
      await appendEvent(tx, {
        projectId: project.id,
        type: CORE_EVENTS.memberAdded,
        source: 'user',
        title: `Kolléga hozzárendelve: ${member.name}`,
        actorId: req.user!.id,
        data: { userId: member.id, name: member.name },
      });
      await writeAudit(tx, {
        userId: req.user!.id,
        action: 'update',
        entityType: 'project',
        entityId: project.id,
        label: project.name,
        projectId: project.id,
        data: { memberAdded: { id: member.id, name: member.name } },
      });
    });
    return reply.code(204).send();
  });

  r.delete('/api/projects/:id/members/:userId', { preHandler: office, schema: { params: MemberParams } }, async (req, reply) => {
    await db.transaction(async (tx) => {
      const [project] = await tx.select().from(projects).where(active(req.params.id)).for('update');
      if (!project) throw notFound('A projekt nem található');
      const [removed] = await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, req.params.userId)))
        .returning({ userId: projectMembers.userId });
      if (!removed) throw notFound('A kolléga nincs hozzárendelve a projekthez');
      const [member] = await tx.select({ name: users.name }).from(users).where(eq(users.id, removed.userId));
      await appendEvent(tx, {
        projectId: project.id,
        type: CORE_EVENTS.memberRemoved,
        source: 'user',
        title: `Kolléga levéve: ${member?.name ?? ''}`,
        actorId: req.user!.id,
        data: { userId: removed.userId, name: member?.name ?? '' },
      });
      await writeAudit(tx, {
        userId: req.user!.id,
        action: 'update',
        entityType: 'project',
        entityId: project.id,
        label: project.name,
        projectId: project.id,
        data: { memberRemoved: { id: removed.userId, name: member?.name ?? '' } },
      });
    });
    return reply.code(204).send();
  });
}
