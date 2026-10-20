import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { eq, sql } from 'drizzle-orm';
import type { Db, ModuleContext } from '@derp/server/module-api';
import {
  CHAT_EVENTS,
  type AttachmentRef,
  type ChatAttachment,
  type ChatMessage,
  type ChatMessageEventData,
  type MessagePage,
  type Person,
  type UnreadSummary,
} from '../shared.ts';
import { parseMentions } from './mentions.ts';
import { chatMessages } from './schema.ts';

interface MessageRow {
  id: string;
  seq: string;
  project_id: string;
  author_id: string;
  author_name: string;
  body: string;
  mentions: string[];
  attachments: AttachmentRef[];
  event_id: string | null;
  created_at: Date;
}

const SELECT_MESSAGES = `
  SELECT m.id, m.seq, m.project_id, m.author_id, u.name AS author_name, m.body, m.mentions, m.attachments, m.event_id, m.created_at
  FROM chat_messages m JOIN users u ON u.id = m.author_id`;

/**
 * Akik a projektet látják (és így említhetők): az aktív irodai felhasználók és a projekthez rendelt aktív kollégák,
 * név szerint.
 */
export async function projectPeople(pool: pg.Pool, projectId: string): Promise<Person[]> {
  const res = await pool.query<Person>(
    `SELECT u.id, u.name FROM users u
     WHERE u.deactivated_at IS NULL
       AND (u.role IN ('admin', 'iroda') OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = u.id))
     ORDER BY u.name COLLATE "C", u.id`,
    [projectId],
  );
  return res.rows;
}

/** Az üzenetek a megemlítettek nevével és a csatolmányok állapotával a dokumentumtárból. */
async function hydrate(pool: pg.Pool, rows: MessageRow[]): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];
  const projectId = rows[0]!.project_id;
  const mentionIds = [...new Set(rows.flatMap((r) => r.mentions))];
  const fileIds = [...new Set(rows.flatMap((r) => r.attachments.map((a) => a.id)))];

  const names = new Map<string, string>();
  if (mentionIds.length > 0) {
    const res = await pool.query<Person>('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [mentionIds]);
    for (const p of res.rows) names.set(p.id, p.name);
  }

  type FileRow = { id: string; name: string; mime: string; size: string; folder_id: string | null; has_thumb: boolean };
  const files = new Map<string, FileRow>();
  const deleted = new Set<string>();
  if (fileIds.length > 0) {
    const f = await pool.query<FileRow>(
      `SELECT f.id, f.name, f.mime, f.size, f.folder_id, b.has_thumb
       FROM docs_files f JOIN docs_blobs b ON b.sha256 = f.sha256
       WHERE f.id = ANY($1::uuid[]) AND f.project_id = $2`,
      [fileIds, projectId],
    );
    for (const row of f.rows) files.set(row.id, row);
    const d = await pool.query<{ id: string }>(
      `SELECT DISTINCT data->>'fileId' AS id FROM events
       WHERE project_id = $1 AND type = 'docs.file_deleted' AND data->>'fileId' = ANY($2::text[])`,
      [projectId, fileIds],
    );
    for (const row of d.rows) deleted.add(row.id);
  }

  const attachment = (a: AttachmentRef): ChatAttachment => {
    const f = files.get(a.id);
    if (f) return { id: a.id, name: f.name, status: 'ready', mime: f.mime, size: Number(f.size), hasThumb: f.has_thumb, folderId: f.folder_id };
    return { id: a.id, name: a.name, status: deleted.has(a.id) ? 'deleted' : 'pending', mime: null, size: null, hasThumb: false, folderId: null };
  };

  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    projectId: r.project_id,
    author: { id: r.author_id, name: r.author_name },
    body: r.body,
    mentions: r.mentions.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    attachments: r.attachments.map(attachment),
    eventId: r.event_id,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getMessage(pool: pg.Pool, id: string): Promise<ChatMessage | null> {
  const res = await pool.query<MessageRow>(`${SELECT_MESSAGES} WHERE m.id = $1`, [id]);
  return (await hydrate(pool, res.rows))[0] ?? null;
}

export interface MessageInput {
  id: string;
  projectId: string;
  body: string;
  attachments: AttachmentRef[];
}

/** Ugyanaz az üzenet-e (újraküldés), vagy az azonosító egy másik üzeneté. */
const sameMessage = (m: ChatMessage, input: MessageInput, authorId: string) =>
  m.projectId === input.projectId &&
  m.author.id === authorId &&
  m.body === input.body &&
  m.attachments.map((a) => a.id).join() === input.attachments.map((a) => a.id).join();

const excerpt = (s: string, max = 80) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/**
 * Új üzenet a kliens által kiosztott azonosítóval. Ugyanazzal az azonosítóval és tartalommal újraküldve a meglévőt
 * adja vissza (`created: false`), eltérő tartalommal 409. Az üzenet eseményt kap az idővonalra; a csatolmányok
 * feltöltésekor a kliens ezt adja meg `parentEventId`-ként.
 */
export async function createMessage(
  ctx: ModuleContext,
  req: FastifyRequest,
  input: MessageInput,
): Promise<{ message: ChatMessage; created: boolean }> {
  const user = req.user!;
  const conflict = () => ctx.errors.conflict('Ez az üzenetazonosító már egy másik üzenethez tartozik');
  const existing = await getMessage(ctx.pool, input.id);
  if (existing) {
    if (!sameMessage(existing, input, user.id)) throw conflict();
    return { message: existing, created: false };
  }

  if (input.attachments.length > 0) {
    const foreign = await ctx.pool.query('SELECT 1 FROM docs_files WHERE id = ANY($1::uuid[]) AND project_id <> $2 LIMIT 1', [
      input.attachments.map((a) => a.id),
      input.projectId,
    ]);
    if (foreign.rowCount) throw ctx.errors.badRequest('A csatolt fájl egy másik projekthez tartozik');
  }

  const people = await projectPeople(ctx.pool, input.projectId);
  const mentions = parseMentions(input.body, people);
  const attachmentNote = input.attachments.length > 0 ? `${input.attachments.length} csatolmány` : '';

  let created = false;
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(chatMessages)
      .values({ id: input.id, projectId: input.projectId, authorId: user.id, body: input.body, mentions, attachments: input.attachments })
      .onConflictDoNothing()
      .returning();
    // Ugyanaz az azonosító közben egy párhuzamos kérésből került be.
    if (!row) return;

    const data: ChatMessageEventData = { messageId: row.id, body: row.body, mentions, attachments: input.attachments.length };
    const eventId = await ctx.appendEvent(
      {
        projectId: input.projectId,
        type: CHAT_EVENTS.messagePosted,
        source: 'user',
        title: `Chat-üzenet: ${excerpt(row.body) || attachmentNote}`,
        actorId: user.id,
        data: { ...data },
      },
      tx,
    );
    await tx.update(chatMessages).set({ eventId }).where(eq(chatMessages.id, row.id));
    // A saját üzenet olvasottnak számít.
    await tx.execute(markReadSql(input.projectId, user.id, row.seq));
    await ctx.audit(req, { action: 'create', entity: 'message', entityId: row.id, label: excerpt(row.body, 60) || attachmentNote, projectId: input.projectId }, tx);
    created = true;
  });

  const message = (await getMessage(ctx.pool, input.id))!;
  if (!created && !sameMessage(message, input, user.id)) throw conflict();
  return { message, created };
}

/** Egy lap a projekt üzeneteiből (`seq` szerint növekvő sorrendben), a felhasználó és a többiek olvasottságával. */
export async function listMessages(
  pool: pg.Pool,
  projectId: string,
  userId: string,
  { before, limit }: { before?: number; limit: number },
): Promise<MessagePage> {
  const res = await pool.query<MessageRow>(
    `${SELECT_MESSAGES} WHERE m.project_id = $1 AND ($2::bigint IS NULL OR m.seq < $2) ORDER BY m.seq DESC LIMIT $3`,
    [projectId, before ?? null, limit + 1],
  );
  const rows = res.rows.slice(0, limit).reverse();
  const items = await hydrate(pool, rows);

  const reads = await pool.query<{ user_id: string; name: string; last_read_seq: string; read_at: Date }>(
    `SELECT r.user_id, u.name, r.last_read_seq, r.read_at FROM chat_reads r JOIN users u ON u.id = r.user_id
     WHERE r.project_id = $1 ORDER BY u.name COLLATE "C"`,
    [projectId],
  );
  const own = reads.rows.find((r) => r.user_id === userId);
  return {
    items,
    nextBefore: res.rows.length > limit ? items[0]!.seq : null,
    lastReadSeq: own ? Number(own.last_read_seq) : 0,
    reads: reads.rows
      .filter((r) => r.user_id !== userId)
      .map((r) => ({ user: { id: r.user_id, name: r.name }, lastReadSeq: Number(r.last_read_seq), readAt: r.read_at.toISOString() })),
  };
}

/** Olvasottság: csak előre léptet, és legfeljebb a projekt utolsó üzenetéig. */
const markReadSql = (projectId: string, userId: string, seq: number) => sql`
  INSERT INTO chat_reads (project_id, user_id, last_read_seq)
  VALUES (${projectId}, ${userId}, LEAST(${seq}::bigint, (SELECT coalesce(max(seq), 0) FROM chat_messages WHERE project_id = ${projectId})))
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET last_read_seq = GREATEST(chat_reads.last_read_seq, excluded.last_read_seq),
        read_at = CASE WHEN excluded.last_read_seq > chat_reads.last_read_seq THEN now() ELSE chat_reads.read_at END
  RETURNING last_read_seq`;

export async function markRead(db: Db, projectId: string, userId: string, seq: number): Promise<number> {
  const res = await db.execute<{ last_read_seq: string }>(markReadSql(projectId, userId, seq));
  return Number(res.rows[0]!.last_read_seq);
}

/** Olvasatlan üzenetek projektenként (a saját üzenetek nélkül) a látható, nem törölt projektekben (`null` = mind). */
export async function unreadSummary(pool: pg.Pool, userId: string, visible: string[] | null): Promise<UnreadSummary> {
  const res = await pool.query<{ project_id: string; unread: string; mentions: string; last_message_at: Date }>(
    `SELECT m.project_id,
            count(*) FILTER (WHERE m.seq > coalesce(r.last_read_seq, 0) AND m.author_id <> $1) AS unread,
            count(*) FILTER (WHERE m.seq > coalesce(r.last_read_seq, 0) AND m.author_id <> $1 AND $1 = ANY (m.mentions)) AS mentions,
            max(m.created_at) AS last_message_at
     FROM chat_messages m
     JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL
     LEFT JOIN chat_reads r ON r.project_id = m.project_id AND r.user_id = $1
     WHERE $2::uuid[] IS NULL OR m.project_id = ANY ($2::uuid[])
     GROUP BY m.project_id
     ORDER BY last_message_at DESC`,
    [userId, visible],
  );
  const projects = res.rows.map((r) => ({
    projectId: r.project_id,
    unread: Number(r.unread),
    mentions: Number(r.mentions),
    lastMessageAt: r.last_message_at.toISOString(),
  }));
  return {
    total: projects.reduce((n, p) => n + p.unread, 0),
    mentions: projects.reduce((n, p) => n + p.mentions, 0),
    projects,
  };
}
