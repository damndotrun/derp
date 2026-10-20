import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// A táblák a migrations/0001_watch_init.sql-lel egyeznek.
export const watchMappings = pgTable('watch_mappings', {
  projectId: uuid('project_id').primaryKey(),
  path: text('path').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  lastError: text('last_error'),
});

export const watchFiles = pgTable('watch_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  path: text('path').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  mtime: timestamp('mtime', { withTimezone: true }).notNull(),
  sha256: text('sha256'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
