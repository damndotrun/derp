import { sql } from 'drizzle-orm';
import type { Db, ModuleSeedContext } from '@derp/server/module-api';
import { GMAIL_EVENTS, type GmailThreadMovedEventData, type MessageDetail, type Suggestion, type ThreadDetail, type ThreadList, type ThreadSummary } from '../shared.ts';
import { deriveStatus, detectProject, hasDeadline, type Direction, type MailKind, type ProjectRule } from './classify.ts';
import { emitThreadEvents } from './sync.ts';

type Exec = Pick<Db, 'execute'>;
const rows = async <T>(db: Exec, q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)).rows as T[];
const isoOf = (v: string | Date) => new Date(v).toISOString();

interface ThreadRow {
  id: string;
  account: string;
  subject: string;
  first_message_at: string | Date;
  last_message_at: string | Date;
  project_id: string | null;
  dismissed_at: string | Date | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  subject: string;
  from_addr: string;
  to_addrs: string[];
  cc_addrs: string[];
  sent_at: string | Date;
  direction: Direction;
  kind: MailKind;
  snippet: string;
  body_text: string;
  attachments: MessageDetail['attachments'];
}

const SELECT_THREADS = sql`
  SELECT t.id, a.email AS account, t.subject, t.first_message_at, t.last_message_at, t.project_id, t.dismissed_at
  FROM gmail_threads t JOIN gmail_accounts a ON a.id = t.account_id`;

const SELECT_MESSAGES = sql`
  SELECT id, thread_id, subject, from_addr, to_addrs, cc_addrs, sent_at, direction, kind, snippet, body_text, attachments
  FROM gmail_messages`;

const toMessage = (m: MessageRow, projectId: string | null): MessageDetail => ({
  id: m.id,
  threadId: m.thread_id,
  projectId,
  subject: m.subject,
  from: m.from_addr,
  to: m.to_addrs,
  cc: m.cc_addrs,
  sentAt: isoOf(m.sent_at),
  direction: m.direction,
  kind: m.kind,
  snippet: m.snippet,
  bodyText: m.body_text,
  attachments: m.attachments,
});

/** A javaslathoz használt szabályok sorrendben; a törölt projektekre mutatók kimaradnak. */
async function activeRules(db: Exec): Promise<Array<ProjectRule & { projectId: string }>> {
  const r = await rows<{ id: string; pattern: string; project_id: string; project_name: string }>(
    db,
    sql`SELECT r.id, r.pattern, r.project_id, p.name AS project_name
        FROM gmail_rules r JOIN projects p ON p.id = r.project_id
        WHERE p.deleted_at IS NULL ORDER BY r.position, r.created_at, r.id`,
  );
  return r.map((x) => ({ id: x.id, name: x.project_name, pattern: x.pattern, projectId: x.project_id }));
}

/** A szál összesítője a leveleiből (időrendben): státusz, határidő, résztvevők, javaslat. */
function summarize(t: ThreadRow, messages: MessageRow[], rules: Array<ProjectRule & { projectId: string }>): ThreadSummary {
  const text = [t.subject, ...messages.flatMap((m) => [m.subject, m.body_text || m.snippet])].join('\n');
  const match = t.project_id ? null : detectProject(text, rules);
  const rule = match ? rules.find((r) => r.id === match.id) : undefined;
  const suggestion: Suggestion | null = rule ? { ruleId: rule.id, projectId: rule.projectId, projectName: rule.name } : null;
  const last = messages.at(-1);
  return {
    id: t.id,
    account: t.account,
    subject: t.subject,
    firstMessageAt: isoOf(t.first_message_at),
    lastMessageAt: isoOf(t.last_message_at),
    messageCount: messages.length,
    participants: [...new Set(messages.map((m) => m.from_addr))],
    lastSnippet: last?.snippet ?? '',
    attachmentCount: messages.reduce((n, m) => n + m.attachments.length, 0),
    status: deriveStatus(messages.map((m) => ({ eventType: m.kind, direction: m.direction }))).key,
    deadline: hasDeadline(text),
    projectId: t.project_id,
    suggestion,
    dismissedAt: t.dismissed_at ? isoOf(t.dismissed_at) : null,
  };
}

async function messagesOf(db: Exec, threadIds: string[]): Promise<Map<string, MessageRow[]>> {
  const byThread = new Map<string, MessageRow[]>(threadIds.map((id) => [id, []]));
  if (threadIds.length === 0) return byThread;
  const r = await rows<MessageRow>(db, sql`${SELECT_MESSAGES} WHERE thread_id = ANY(${sql.param(threadIds)}::uuid[]) ORDER BY sent_at, id`);
  for (const m of r) byThread.get(m.thread_id)!.push(m);
  return byThread;
}

/**
 * A „Hozzárendeletlen levelek”: a projekthez nem rendelt, el nem vetett szálak, a legutóbb aktív elöl; `dismissed`
 * nézetben az elvetettek (a legutóbb elvetett elöl).
 */
export async function listUnassigned(
  db: Db,
  { limit, offset, view }: { limit: number; offset: number; view: 'open' | 'dismissed' },
): Promise<ThreadList> {
  const where = view === 'open' ? sql`t.project_id IS NULL AND t.dismissed_at IS NULL` : sql`t.project_id IS NULL AND t.dismissed_at IS NOT NULL`;
  const order = view === 'open' ? sql`t.last_message_at DESC, t.id` : sql`t.dismissed_at DESC, t.id`;
  const [{ total } = { total: 0 }] = await rows<{ total: number }>(db, sql`SELECT count(*)::int AS total FROM gmail_threads t WHERE ${where}`);
  const threads = await rows<ThreadRow>(db, sql`${SELECT_THREADS} WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`);
  const messages = await messagesOf(db, threads.map((t) => t.id));
  const rules = await activeRules(db);
  return { items: threads.map((t) => summarize(t, messages.get(t.id)!, rules)), total };
}

/** Egy szál a leveleivel (törzzsel); `null`, ha nincs ilyen. */
export async function getThread(db: Db, id: string): Promise<ThreadDetail | null> {
  const [t] = await rows<ThreadRow>(db, sql`${SELECT_THREADS} WHERE t.id = ${id}`);
  if (!t) return null;
  const messages = (await messagesOf(db, [t.id])).get(t.id)!;
  return { ...summarize(t, messages, await activeRules(db)), messages: messages.map((m) => toMessage(m, t.project_id)) };
}

/** Egy levél (törzzsel) és a szálának projektje; `null`, ha nincs ilyen. */
export async function getMessage(db: Db, id: string): Promise<MessageDetail | null> {
  const [m] = await rows<MessageRow & { project_id: string | null }>(
    db,
    sql`SELECT m.id, m.thread_id, m.subject, m.from_addr, m.to_addrs, m.cc_addrs, m.sent_at, m.direction, m.kind, m.snippet, m.body_text,
          m.attachments, t.project_id
        FROM gmail_messages m JOIN gmail_threads t ON t.id = m.thread_id WHERE m.id = ${id}`,
  );
  return m ? toMessage(m, m.project_id) : null;
}

export type AssignOutcome =
  | { status: 'assigned'; events: number }
  | { status: 'moved'; fromProjectId: string; events: number }
  | { status: 'unchanged' }
  | { status: 'not_found' };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A szál projekthez rendelése vagy áthelyezése. Hozzárendeléskor a levelei eseményként az idővonalra kerülnek (a
 * későbbi levelei a betöltéskor), az elvetés megszűnik. Áthelyezéskor (az események csak hozzáfűzhetők) a régi
 * projekt idővonalára `gmail.thread_moved` esemény kerül, a levelek pedig újra, az új projekt idővonalára.
 */
export async function assignThread(
  db: Db,
  appendEvent: ModuleSeedContext['appendEvent'],
  input: { threadId: string; projectId: string; userId: string },
  onChanged?: (tx: Tx, subject: string, fromProjectId: string | null) => Promise<void>,
): Promise<AssignOutcome> {
  return db.transaction(async (tx) => {
    const [t] = await rows<{ id: string; project_id: string | null; subject: string }>(
      tx,
      sql`SELECT id, project_id, subject FROM gmail_threads WHERE id = ${input.threadId} FOR UPDATE`,
    );
    if (!t) return { status: 'not_found' } as const;
    if (t.project_id === input.projectId) return { status: 'unchanged' } as const;
    await tx.execute(
      sql`UPDATE gmail_threads SET project_id = ${input.projectId}, assigned_by = ${input.userId}, assigned_at = now(),
            dismissed_at = NULL, dismissed_by = NULL
          WHERE id = ${t.id}`,
    );
    if (t.project_id) {
      const [{ n } = { n: 0 }] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM gmail_messages WHERE thread_id = ${t.id}`);
      const data: GmailThreadMovedEventData = { threadId: t.id, subject: t.subject, toProjectId: input.projectId, messages: n };
      await appendEvent(
        {
          projectId: t.project_id,
          type: GMAIL_EVENTS.threadMoved,
          source: 'user',
          title: `Levélszál áthelyezve másik projektbe: ${t.subject.trim() || '(nincs tárgy)'}`,
          actorId: input.userId,
          data: { ...data },
        },
        tx,
      );
      await tx.execute(sql`UPDATE gmail_messages SET event_id = NULL WHERE thread_id = ${t.id}`);
    }
    const events = await emitThreadEvents(tx, appendEvent, t.id, input.projectId);
    await onChanged?.(tx, t.subject, t.project_id);
    return t.project_id ? ({ status: 'moved', fromProjectId: t.project_id, events } as const) : ({ status: 'assigned', events } as const);
  });
}

export type DismissOutcome = { status: 'ok'; subject: string } | { status: 'assigned' } | { status: 'not_found' };

/** Hozzárendeletlen szál elvetése vagy visszaállítása; projekthez rendelt szálnál `assigned`. */
export async function setDismissed(db: Db, input: { threadId: string; dismissed: boolean; userId: string }): Promise<DismissOutcome> {
  const [t] = await rows<{ project_id: string | null; subject: string }>(db, sql`SELECT project_id, subject FROM gmail_threads WHERE id = ${input.threadId}`);
  if (!t) return { status: 'not_found' };
  if (t.project_id) return { status: 'assigned' };
  await db.execute(
    input.dismissed
      ? sql`UPDATE gmail_threads SET dismissed_at = coalesce(dismissed_at, now()), dismissed_by = ${input.userId} WHERE id = ${input.threadId} AND project_id IS NULL`
      : sql`UPDATE gmail_threads SET dismissed_at = NULL, dismissed_by = NULL WHERE id = ${input.threadId} AND project_id IS NULL`,
  );
  return { status: 'ok', subject: t.subject };
}
