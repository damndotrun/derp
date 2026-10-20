import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ModuleContext } from '@derp/server/module-api';
import {
  Account,
  AccountCreate,
  AccountList,
  AttachmentMeta,
  MessageDetail,
  Rule,
  RuleCreate,
  RuleList,
  RuleUpdate,
  SyncResults,
  ThreadAssign,
  ThreadDetail,
  ThreadList,
  ThreadsQuery,
  type SyncResult,
} from '../shared.ts';
import { addAccount, getAccount, listAccounts } from './accounts.ts';
import { createSource, mailSourceKind, mockSource } from './mail-source.ts';
import { createRule, deleteRule, listRules, updateRule } from './rules.ts';
import { syncAccount, syncAll, type SyncDeps } from './sync.ts';
import { assignThread, getMessage, getThread, listUnassigned } from './threads.ts';

/** A növekményes betöltés gyakorisága (spec: 15 percenként `history.list`). */
export const SYNC_INTERVAL_MS = 15 * 60_000;

export async function routes(app: FastifyInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const kind = mailSourceKind();
  const source = createSource(kind);
  const deps: SyncDeps = { db: ctx.db, appendEvent: ctx.appendEvent, source };

  // A betöltések sorban futnak: a futás közben kért betöltés utána indul, így a közben érkezett levelet is látja.
  let last: Promise<unknown> = Promise.resolve();
  const runSync = (): Promise<SyncResult[]> => {
    const run = last.then(() => syncAll(deps, (account, err) => app.log.error({ err, account }, 'gmail: a fiók betöltése nem sikerült')));
    last = run.catch(() => undefined);
    return run;
  };

  // Ütemezett betöltés (tesztben nem: ott a seed, a kézi gomb és a teszt-végpont tölt be).
  if (ctx.config.nodeEnv !== 'test') {
    const first = setTimeout(() => void runSync(), 5_000);
    const timer = setInterval(() => void runSync(), SYNC_INTERVAL_MS);
    first.unref();
    timer.unref();
    app.addHook('onClose', async () => {
      clearTimeout(first);
      clearInterval(timer);
      await last;
    });
  }

  const canAssign = ctx.requirePermission('gmail.assign');
  /** Hozzárendeletlen szál levelét csak az nyithatja meg, aki hozzárendelhet; a projekthez rendeltet, aki a projektet látja. */
  const requireThreadAccess = async (req: FastifyRequest, reply: FastifyReply, projectId: string | null) => {
    if (projectId) await ctx.requireProject(req, projectId);
    else await canAssign.call(app, req, reply);
  };

  const idParams = z.object({ id: z.uuid() });

  r.get(
    '/api/gmail/threads',
    { preHandler: canAssign, schema: { querystring: ThreadsQuery, response: { 200: ThreadList } } },
    async (req) => listUnassigned(ctx.db, req.query),
  );

  r.get('/api/gmail/threads/:id', { schema: { params: idParams, response: { 200: ThreadDetail } } }, async (req, reply) => {
    const thread = await getThread(ctx.db, req.params.id);
    if (!thread) throw ctx.errors.notFound('A levélszál nem található');
    await requireThreadAccess(req, reply, thread.projectId);
    await ctx.audit(req, { action: 'view', entity: 'thread', entityId: thread.id, label: thread.subject, projectId: thread.projectId });
    return thread;
  });

  // Szál → projekt. Ugyanahhoz a projekthez újra: 200 (nem változik); másik projekthez: 409.
  r.put(
    '/api/gmail/threads/:id/project',
    { preHandler: canAssign, schema: { params: idParams, body: ThreadAssign, response: { 200: ThreadDetail } } },
    async (req) => {
      const project = await ctx.requireProject(req, req.body.projectId);
      const outcome = await assignThread(ctx.db, ctx.appendEvent, { threadId: req.params.id, projectId: project.id, userId: req.user!.id }, (tx, subject) =>
        ctx.audit(
          req,
          { action: 'update', entity: 'thread', entityId: req.params.id, label: subject, projectId: project.id, data: { projectId: project.id } },
          tx,
        ),
      );
      if (outcome.status === 'not_found') throw ctx.errors.notFound('A levélszál nem található');
      if (outcome.status === 'conflict') throw ctx.errors.conflict('A levélszál már egy másik projekthez tartozik');
      return (await getThread(ctx.db, req.params.id))!;
    },
  );

  r.get('/api/gmail/messages/:id', { schema: { params: idParams, response: { 200: MessageDetail } } }, async (req, reply) => {
    const message = await getMessage(ctx.db, req.params.id);
    if (!message) throw ctx.errors.notFound('A levél nem található');
    await requireThreadAccess(req, reply, message.projectId);
    await ctx.audit(req, { action: 'view', entity: 'message', entityId: message.id, label: message.subject, projectId: message.projectId });
    return message;
  });

  r.post('/api/gmail/sync', { preHandler: canAssign, schema: { response: { 200: SyncResults } } }, async () => ({ items: await runSync() }));

  // Szabályok: javaslat a hozzárendeléshez (az első illeszkedő nyer).
  const canEditRules = ctx.requirePermission('gmail.rules');
  r.get('/api/gmail/rules', { preHandler: canEditRules, schema: { response: { 200: RuleList } } }, async () => ({ items: await listRules(ctx.db) }));

  r.post('/api/gmail/rules', { preHandler: canEditRules, schema: { body: RuleCreate, response: { 201: Rule } } }, async (req, reply) => {
    await ctx.requireProject(req, req.body.projectId);
    const rule = await createRule(ctx.db, { ...req.body, userId: req.user!.id });
    await ctx.audit(req, { action: 'create', entity: 'rule', entityId: rule.id, label: rule.pattern, data: { projectId: rule.projectId } });
    return reply.code(201).send(rule);
  });

  r.patch(
    '/api/gmail/rules/:id',
    { preHandler: canEditRules, schema: { params: idParams, body: RuleUpdate, response: { 200: Rule } } },
    async (req) => {
      if (req.body.projectId) await ctx.requireProject(req, req.body.projectId);
      const rule = await updateRule(ctx.db, req.params.id, req.body);
      if (!rule) throw ctx.errors.notFound('A szabály nem található');
      await ctx.audit(req, { action: 'update', entity: 'rule', entityId: rule.id, label: rule.pattern, data: { ...req.body } });
      return rule;
    },
  );

  r.delete('/api/gmail/rules/:id', { preHandler: canEditRules, schema: { params: idParams } }, async (req, reply) => {
    const rule = await deleteRule(ctx.db, req.params.id);
    if (!rule) throw ctx.errors.notFound('A szabály nem található');
    await ctx.audit(req, { action: 'delete', entity: 'rule', entityId: rule.id, label: rule.pattern });
    return reply.code(204).send();
  });

  // Fiókok (admin). Mock-forrásnál a felvétel azonnal betölt; az élő OAuth-bekötés a 14. munkacsomagban jön.
  const canManageAccounts = ctx.requirePermission('gmail.accounts');
  r.get('/api/gmail/accounts', { preHandler: canManageAccounts, schema: { response: { 200: AccountList } } }, async () => ({
    source: kind,
    items: await listAccounts(ctx.db),
  }));

  r.post(
    '/api/gmail/accounts',
    { preHandler: canManageAccounts, schema: { body: AccountCreate, response: { 201: Account } } },
    async (req, reply) => {
      if (kind !== 'mock') throw ctx.errors.badRequest('Az élő Gmail-fiók bekötése a 14. munkacsomagban készül');
      const id = await addAccount(ctx.db, { email: req.body.email, source: kind, userId: req.user!.id });
      if (!id) throw ctx.errors.conflict('Ez a fiók már be van kötve');
      await ctx.audit(req, { action: 'create', entity: 'account', entityId: id, label: req.body.email });
      await syncAccount(deps, { id, email: req.body.email, historyId: null }).catch((err: unknown) =>
        app.log.error({ err, account: req.body.email }, 'gmail: a fiók első betöltése nem sikerült'),
      );
      return reply.code(201).send((await getAccount(ctx.db, id))!);
    },
  );

  // Csak tesztben: új levél a mock-postafiókba, majd betöltés (a Playwright-teszt így újrafuttatható ugyanazon az adatbázison).
  if (ctx.config.nodeEnv === 'test' && kind === 'mock') {
    const Deliver = z.object({
      threadId: z.string().min(1).max(200).optional(),
      from: z.string().min(1).max(320),
      to: z.array(z.string()).default(['levelek@derp.test']),
      subject: z.string().max(500),
      body: z.string().max(20_000),
      attachments: z.array(AttachmentMeta).default([]),
    });
    r.post('/api/gmail/test/deliver', { schema: { body: Deliver } }, async (req) => {
      const id = `mock-x-${crypto.randomUUID()}`;
      const b = req.body;
      mockSource().deliver({
        id,
        threadId: b.threadId ?? `mock-xt-${crypto.randomUUID()}`,
        minutesAgo: 0,
        from: b.from,
        to: b.to,
        subject: b.subject,
        body: b.body,
        attachments: b.attachments.map((a, i) => ({ ...a, attachmentId: `${id}-a${i}` })),
      });
      const results = await runSync();
      // A kézbesített levél szála a dERP-ben (minden mock-fiókban egy).
      const threads = await ctx.db.execute<{ id: string }>(sql`SELECT DISTINCT thread_id AS id FROM gmail_messages WHERE gmail_message_id = ${id}`);
      return { results, threadIds: threads.rows.map((t) => t.id) };
    });
  }
}
