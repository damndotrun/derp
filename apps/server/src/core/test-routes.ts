import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { TestEventsCreate } from '@derp/shared';
import type { Db } from './db.ts';
import { appendEvent } from './events.ts';
import { getVisibleProject } from './projects.ts';

// Csak `NODE_ENV=test` mellett regisztrált végpontok az e2e-tesztekhez (az app.ts dönti el); élesben nincsenek.

/** `POST /api/test/events`: események tetszőleges (múltbeli) időponttal, hogy az idővonal napi/heti csoportjai tesztelhetők legyenek. */
export async function testRoutes(app: FastifyInstance, { db }: { db: Db }): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post('/api/test/events', { schema: { body: TestEventsCreate } }, async (req, reply) => {
    const { projectId, events } = req.body;
    await getVisibleProject(db, req.user!, projectId);
    const ids = await db.transaction(async (tx) => {
      const out: string[] = [];
      for (const e of events) {
        out.push(
          await appendEvent(tx, {
            projectId,
            type: e.type,
            source: 'test',
            title: e.title,
            actorId: req.user!.id,
            data: e.data,
            parentId: e.parentId ?? null,
            occurredAt: e.occurredAt ? new Date(e.occurredAt) : undefined,
          }),
        );
      }
      return out;
    });
    return reply.code(201).send({ ids });
  });
}
