import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { CORE_MIGRATIONS, runMigrations } from '../src/core/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * A DATABASE_URL szerverén egy ideiglenes adatbázist hoz létre a futás idejére, és a végén eldobja,
 * így a tesztek nem nyúlnak a DATABASE_URL-ben megadott adatbázis tartalmához.
 */
export default async function setup(project: TestProject) {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'A szerver tesztjeihez DATABASE_URL kell (PostgreSQL 16), pl. `pnpm db:up` után ' +
        'DATABASE_URL=postgres://derp:derp@localhost:5432/derp',
    );
  }
  const name = `derp_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(base);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  await runMigrations(pool, [CORE_MIGRATIONS]);
  await pool.end();

  project.provide('databaseUrl', url.toString());

  return async () => {
    const c = new pg.Client({ connectionString: base });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  };
}
