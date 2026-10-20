import { pgTable, smallint, text } from 'drizzle-orm/pg-core';

// A tábla a migrations/0001_example_init.sql-lel egyezik.
export const exampleGreeting = pgTable('example_greeting', {
  id: smallint('id').primaryKey().default(1),
  text: text('text').notNull(),
});
