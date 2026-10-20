import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { MaterialItem, PhotoRef } from '../shared.ts';

// A táblák a migrations/0001_notes_init.sql-lel egyeznek.
export const notesNotes = pgTable('notes_notes', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  eventId: uuid('event_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notesSurveys = pgTable('notes_surveys', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id').notNull(),
  authorId: uuid('author_id').notNull(),
  location: text('location').notNull(),
  condition: text('condition').notNull(),
  proposedWork: text('proposed_work').notNull(),
  materials: jsonb('materials').$type<MaterialItem[]>().notNull(),
  photos: jsonb('photos').$type<PhotoRef[]>().notNull().default([]),
  eventId: uuid('event_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
