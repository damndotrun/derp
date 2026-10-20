import { bigint, customType, date, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { QuoteItem, QuoteStatus } from '../shared/schemas.ts';

// A táblák a migrations/0001_quotes_init.sql-lel egyeznek.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const quotes = pgTable('quotes_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull().generatedAlwaysAsIdentity(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const versions = pgTable('quotes_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull(),
  versionNo: integer('version_no').notNull(),
  status: text('status').$type<QuoteStatus>().notNull().default('tervezet'),
  revision: integer('revision').notNull().default(1),
  items: jsonb('items').$type<QuoteItem[]>().notNull().default([]),
  note: text('note').notNull().default(''),
  validUntil: date('valid_until', { mode: 'string' }),
  eventId: uuid('event_id'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pdfs = pgTable('quotes_pdfs', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull(),
  revision: integer('revision').notNull(),
  fileName: text('file_name').notNull(),
  content: bytea('content').notNull(),
  totalFiller: bigint('total_filler', { mode: 'number' }).notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('quotes_settings', {
  id: smallint('id').primaryKey().default(1),
  companyName: text('company_name').notNull().default(''),
  address: text('address').notNull().default(''),
  taxNumber: text('tax_number').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  bankAccount: text('bank_account').notNull().default(''),
  footer: text('footer').notNull().default(''),
  logo: bytea('logo'),
  logoMime: text('logo_mime').$type<'image/png' | 'image/jpeg'>(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
