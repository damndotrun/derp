import { bigint, bigserial, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AttachmentRef } from '../shared.ts';

// A táblák a migrations/0001_chat_init.sql-lel egyeznek.
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey(),
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  projectId: uuid('project_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  mentions: uuid('mentions').array().notNull().default([]),
  attachments: jsonb('attachments').$type<AttachmentRef[]>().notNull().default([]),
  eventId: uuid('event_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatReads = pgTable(
  'chat_reads',
  {
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id').notNull(),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);
