import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { VisitStatus } from '../shared/schemas.ts';

// A táblák a migrations/0001_visits_init.sql-lel egyeznek. A mag tábláit (projects, users, project_members) a modul
// csak olvassa, nyers SQL-lel.

export const visit = pgTable('visits_visit', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  address: text('address').notNull().default(''),
  task: text('task').notNull().default(''),
  status: text('status').$type<VisitStatus>().notNull().default('utemezett'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const assignee = pgTable(
  'visits_assignee',
  {
    visitId: uuid('visit_id').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.visitId, t.userId] })],
);

export const icsToken = pgTable('visits_ics_token', {
  userId: uuid('user_id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
