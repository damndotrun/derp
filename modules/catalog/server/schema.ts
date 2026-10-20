import { bigint, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { VatRate } from '../shared/schemas.ts';

// A tábla a migrations/0001_catalog_init.sql-lel egyezik.

export const item = pgTable('catalog_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  netUnitPriceFiller: bigint('net_unit_price_filler', { mode: 'number' }).notNull(),
  vatRate: smallint('vat_rate').$type<VatRate>().notNull(),
  supplier: text('supplier').notNull().default(''),
  searchText: text('search_text').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
