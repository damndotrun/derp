import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;

export function createPool(databaseUrl: string): pg.Pool {
  // Kis példányszám (5–30 felhasználó), szűk memóriakorlát: kevés kapcsolat elég.
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}
