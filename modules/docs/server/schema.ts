import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// A táblák a migrations/0001_docs_init.sql-lel egyeznek.
export const docsBlobs = pgTable('docs_blobs', {
  sha256: text('sha256').primaryKey(),
  size: bigint('size', { mode: 'number' }).notNull(),
  hasThumb: boolean('has_thumb').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const docsFolders = pgTable('docs_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const docsFiles = pgTable('docs_files', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull(),
  folderId: uuid('folder_id'),
  sha256: text('sha256').notNull(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  uploadedBy: uuid('uploaded_by'),
  eventId: uuid('event_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
