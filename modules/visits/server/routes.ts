import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import {
  IcsTokenCreated,
  IcsTokenInfo,
  MineQuery,
  MineResponse,
  Visit,
  VISIT_EVENTS,
  VisitCreate,
  VisitList,
  VisitListQuery,
  VisitUpdate,
  type VisitAssignee,
  type VisitEventData,
} from '../shared/schemas.ts';
import { FEED_PAST_DAYS, hashToken, ICS_FILE, newToken, renderFeed, resolvePepper } from './ics.ts';
import { assignee, icsToken, visit } from './schema.ts';
import { checkAssignees, getVisit, listVisits, visitProjectId, type Viewer } from './visits.ts';
import { localDate, localRange } from '../shared/time.ts';

const IdParams = z.object({ id: z.uuid() });

type VisitRow = typeof visit.$inferSelect;

const eventData = (v: VisitRow, assignees: VisitAssignee[], changed?: string[]): VisitEventData => ({
  visitId: v.id,
  startsAt: v.startsAt.toISOString(),
  endsAt: v.endsAt.toISOString(),
  address: v.address,
  task: v.task,
  status: v.status,
  assignees,
  ...(changed ? { changed } : {}),
});

async function viewerOf(ctx: ModuleContext, req: FastifyRequest): Promise<Viewer> {
  return { userId: req.user!.id, visibleProjectIds: await ctx.visibleProjectIds(req) };
}

/** A kiszállás a kérdező szemével: a projektjét látnia kell (különben 403), a terepesnek beosztottnak is kell lennie. */
async function requireVisit(ctx: ModuleContext, req: FastifyRequest, id: string): Promise<Visit> {
  const projectId = await visitProjectId(ctx.pool, id);
  if (!projectId) throw ctx.errors.notFound('A kiszállás nem található');
  await ctx.requireProject(req, projectId);
  const v = await getVisit(ctx.pool, id, await viewerOf(ctx, req));
  if (!v) throw ctx.errors.forbidden();
  return v;
}

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = ctx.requirePermission('visits.manage');
  const pepper = resolvePepper(process.env, ctx.config.nodeEnv);
  const tz = ctx.config.tzDisplay;

  // Napi/heti nézet: a megadott időszakkal átfedő kiszállások (a terepesnek csak a saját, látható projekten).
  r.get('/api/visits', { schema: { querystring: VisitListQuery, response: { 200: VisitList } } }, async (req) => {
    const { from, to, userId } = req.query;
    return { items: await listVisits(ctx.pool, { from: new Date(from), to: new Date(to), userId }, await viewerOf(ctx, req)) };
  });

  // „Mai kiszállásaim”: a bejelentkezett kolléga kiszállásai egy helyi naptári napon (alapból ma, TZ_DISPLAY szerint).
  r.get('/api/visits/mine', { schema: { querystring: MineQuery, response: { 200: MineResponse } } }, async (req) => {
    const date = req.query.date ?? localDate(new Date(), tz);
    const { from, to } = localRange(date, 1, tz);
    const items = await listVisits(ctx.pool, { from, to, userId: req.user!.id }, await viewerOf(ctx, req));
    return { date, items };
  });

  r.get('/api/visits/ics-token', { schema: { response: { 200: IcsTokenInfo } } }, async (req) => {
    const [row] = await ctx.db.select({ createdAt: icsToken.createdAt }).from(icsToken).where(eq(icsToken.userId, req.user!.id));
    return { exists: !!row, createdAt: row?.createdAt.toISOString() ?? null };
  });

  // Új ICS-link (a régi azonnal érvénytelen). A token csak ebben a válaszban látszik, az adatbázisban a hash-e van.
  r.post('/api/visits/ics-token', { schema: { response: { 201: IcsTokenCreated } } }, async (req, reply) => {
    const token = newToken();
    const createdAt = new Date();
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(icsToken)
        .values({ userId: req.user!.id, tokenHash: hashToken(pepper, token), createdAt })
        .onConflictDoUpdate({ target: icsToken.userId, set: { tokenHash: hashToken(pepper, token), createdAt } });
      await ctx.audit(req, { action: 'update', entity: 'ics_token', entityId: req.user!.id, label: req.user!.name }, tx);
    });
    return reply.code(201).send({ url: `${ctx.config.publicBaseUrl}/api/ics/${token}.ics`, createdAt: createdAt.toISOString() });
  });

  r.get('/api/visits/:id', { schema: { params: IdParams, response: { 200: Visit } } }, async (req) => requireVisit(ctx, req, req.params.id));

  r.post(
    '/api/visits',
    { preHandler: manage, schema: { body: VisitCreate, response: { 201: Visit } } },
    async (req, reply) => {
      const body = req.body;
      const project = await ctx.requireProject(req, body.projectId);
      const { assignees, error } = await checkAssignees(ctx.pool, project.id, body.assigneeIds);
      if (error) throw ctx.errors.badRequest(error);
      const id = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(visit)
          .values({
            projectId: project.id,
            startsAt: new Date(body.startsAt),
            endsAt: new Date(body.endsAt),
            address: body.address,
            task: body.task,
            status: body.status,
            createdBy: req.user!.id,
          })
          .returning();
        await tx.insert(assignee).values(assignees.map((a) => ({ visitId: row!.id, userId: a.id })));
        await ctx.appendEvent(
          {
            projectId: project.id,
            type: VISIT_EVENTS.scheduled,
            source: 'user',
            title: 'Kiszállás ütemezve',
            actorId: req.user!.id,
            data: { ...eventData(row!, assignees) },
          },
          tx,
        );
        await ctx.audit(req, { action: 'create', entity: 'visit', entityId: row!.id, label: project.name, projectId: project.id }, tx);
        return row!.id;
      });
      return reply.code(201).send((await getVisit(ctx.pool, id, null))!);
    },
  );

  r.patch(
    '/api/visits/:id',
    { preHandler: manage, schema: { params: IdParams, body: VisitUpdate, response: { 200: Visit } } },
    async (req) => {
      const current = await requireVisit(ctx, req, req.params.id);
      const { version, assigneeIds, ...fields } = req.body;
      let assignees = current.assignees;
      if (assigneeIds) {
        const checked = await checkAssignees(ctx.pool, current.projectId, assigneeIds);
        if (checked.error) throw ctx.errors.badRequest(checked.error);
        assignees = checked.assignees;
      }
      await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(visit)
          .where(and(eq(visit.id, current.id), isNull(visit.deletedAt)))
          .for('update');
        if (!row) throw ctx.errors.notFound('A kiszállás nem található');
        if (row.version !== version) throw ctx.errors.conflict('A kiszállást közben más módosította; töltsd újra');
        const next = {
          startsAt: fields.startsAt ? new Date(fields.startsAt) : row.startsAt,
          endsAt: fields.endsAt ? new Date(fields.endsAt) : row.endsAt,
          address: fields.address ?? row.address,
          task: fields.task ?? row.task,
          status: fields.status ?? row.status,
        };
        if (next.startsAt >= next.endsAt) throw ctx.errors.badRequest('A vége a kezdés után legyen');
        const changed: string[] = [];
        if (next.startsAt.getTime() !== row.startsAt.getTime()) changed.push('startsAt');
        if (next.endsAt.getTime() !== row.endsAt.getTime()) changed.push('endsAt');
        for (const k of ['address', 'task', 'status'] as const) if (next[k] !== row[k]) changed.push(k);
        const before = new Set(current.assignees.map((a) => a.id));
        const assigneesChanged = assignees.length !== before.size || assignees.some((a) => !before.has(a.id));
        if (assigneesChanged) changed.push('assignees');
        if (changed.length === 0) return;

        const [updated] = await tx
          .update(visit)
          .set({ ...next, version: row.version + 1, updatedAt: new Date() })
          .where(eq(visit.id, row.id))
          .returning();
        if (assigneesChanged) {
          await tx.delete(assignee).where(eq(assignee.visitId, row.id));
          await tx.insert(assignee).values(assignees.map((a) => ({ visitId: row.id, userId: a.id })));
        }
        await ctx.appendEvent(
          {
            projectId: row.projectId,
            type: VISIT_EVENTS.updated,
            source: 'user',
            title: 'Kiszállás módosítva',
            actorId: req.user!.id,
            data: { ...eventData(updated!, assignees, changed) },
          },
          tx,
        );
        await ctx.audit(
          req,
          { action: 'update', entity: 'visit', entityId: row.id, label: current.projectName, projectId: row.projectId, data: { changed } },
          tx,
        );
      });
      return (await getVisit(ctx.pool, current.id, null))!;
    },
  );

  // Törlés rejtéssel; az idővonalon „Kiszállás törölve” esemény marad.
  r.delete('/api/visits/:id', { preHandler: manage, schema: { params: IdParams } }, async (req, reply) => {
    const current = await requireVisit(ctx, req, req.params.id);
    await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(visit)
        .set({ deletedAt: new Date() })
        .where(and(eq(visit.id, current.id), isNull(visit.deletedAt)))
        .returning();
      if (!row) throw ctx.errors.notFound('A kiszállás nem található');
      await ctx.appendEvent(
        {
          projectId: row.projectId,
          type: VISIT_EVENTS.cancelled,
          source: 'user',
          title: 'Kiszállás törölve',
          actorId: req.user!.id,
          data: { ...eventData(row, current.assignees) },
        },
        tx,
      );
      await ctx.audit(req, { action: 'delete', entity: 'visit', entityId: row.id, label: current.projectName, projectId: row.projectId }, tx);
    });
    return reply.code(204).send();
  });
}

/** Belépés nélküli útvonal: a tokenes ICS-feed (a Cloudflare Access Bypass a `/api/ics/*`-ra vonatkozik). */
export async function publicRoutes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const pepper = resolvePepper(process.env, ctx.config.nodeEnv);

  r.get('/api/ics/:file', { schema: { params: z.object({ file: z.string() }) } }, async (req, reply) => {
    const token = ICS_FILE.exec(req.params.file)?.[1];
    if (!token) throw ctx.errors.notFound();
    const { rows } = await ctx.pool.query<{ id: string; name: string; role: string }>(
      `SELECT u.id, u.name, u.role FROM visits_ics_token t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND u.deactivated_at IS NULL`,
      [hashToken(pepper, token)],
    );
    const user = rows[0];
    if (!user) throw ctx.errors.notFound();
    // A feed ugyanazt mutatja, mint a „Mai kiszállásaim”: a terepesnek csak a hozzá rendelt projekteken.
    const visibleProjectIds =
      user.role === 'terepes'
        ? (await ctx.pool.query<{ project_id: string }>('SELECT project_id FROM project_members WHERE user_id = $1', [user.id])).rows.map(
            (m) => m.project_id,
          )
        : null;
    const visits = await listVisits(
      ctx.pool,
      { userId: user.id, startsAfter: new Date(Date.now() - FEED_PAST_DAYS * 86_400_000) },
      { userId: user.id, visibleProjectIds },
    );
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('cache-control', 'private, no-cache')
      .header('x-robots-tag', 'noindex')
      .send(renderFeed({ userName: user.name, visits, publicBaseUrl: ctx.config.publicBaseUrl }));
  });
}
