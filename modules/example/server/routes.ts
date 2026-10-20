import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { getGreeting } from './greeting.ts';

export const EXAMPLE_PINGED = 'example.pinged';

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/example/greeting', { schema: { response: { 200: z.object({ text: z.string() }) } } }, async () => ({
    text: await getGreeting(ctx.db),
  }));

  // Minta esemény a projekt eseménynaplójába; az SSE-n át a nyitott adatlapokon újratöltés nélkül megjelenik.
  r.post(
    '/api/example/projects/:id/ping',
    {
      preHandler: ctx.requirePermission('example.ping'),
      schema: { params: z.object({ id: z.uuid() }), response: { 201: z.object({ eventId: z.uuid() }) } },
    },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.id);
      const eventId = await ctx.appendEvent({
        projectId: project.id,
        type: EXAMPLE_PINGED,
        source: 'user',
        title: 'Minta esemény',
        actorId: req.user!.id,
        data: { greeting: await getGreeting(ctx.db) },
      });
      return reply.code(201).send({ eventId });
    },
  );
}
