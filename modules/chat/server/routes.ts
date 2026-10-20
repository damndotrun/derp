import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import { ChatMessage, MessageCreate, MessagePage, MessagesQuery, PeopleList, ReadUpdate, UnreadSummary } from '../shared.ts';
import { createMessage, listMessages, markRead, projectPeople, unreadSummary } from './messages.ts';

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const projectParams = z.object({ projectId: z.uuid() });

  r.get(
    '/api/chat/projects/:projectId/messages',
    { schema: { params: projectParams, querystring: MessagesQuery, response: { 200: MessagePage } } },
    async (req) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      return listMessages(ctx.pool, project.id, req.user!.id, req.query);
    },
  );

  // Új üzenet a kliens által kiosztott azonosítóval: új üzenetnél 201, ugyanazzal újraküldve 200, mással 409.
  r.put(
    '/api/chat/projects/:projectId/messages/:messageId',
    {
      preHandler: ctx.requirePermission('chat.post'),
      schema: { params: projectParams.extend({ messageId: z.uuid() }), body: MessageCreate, response: { 200: ChatMessage, 201: ChatMessage } },
    },
    async (req, reply) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      const { message, created } = await createMessage(ctx, req, { id: req.params.messageId, projectId: project.id, ...req.body });
      return reply.code(created ? 201 : 200).send(message);
    },
  );

  r.put(
    '/api/chat/projects/:projectId/read',
    { schema: { params: projectParams, body: ReadUpdate, response: { 200: z.object({ lastReadSeq: z.number().int() }) } } },
    async (req) => {
      const project = await ctx.requireProject(req, req.params.projectId);
      return { lastReadSeq: await markRead(ctx.db, project.id, req.user!.id, req.body.seq) };
    },
  );

  // Akiket az üzenetben @-tal meg lehet említeni (a projektet látják).
  r.get('/api/chat/projects/:projectId/people', { schema: { params: projectParams, response: { 200: PeopleList } } }, async (req) => {
    const project = await ctx.requireProject(req, req.params.projectId);
    return { items: await projectPeople(ctx.pool, project.id) };
  });

  r.get('/api/chat/unread', { schema: { response: { 200: UnreadSummary } } }, async (req) =>
    unreadSummary(ctx.pool, req.user!.id, await ctx.visibleProjectIds(req)),
  );
}
