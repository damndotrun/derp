import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/** Egy migrációs forrás: a mag (`core`) vagy egy modul (`modules/<id>/migrations`). */
export interface MigrationSource {
  scope: string;
  dir: string;
}

export const CORE_MIGRATIONS: MigrationSource = {
  scope: 'core',
  dir: fileURLToPath(new URL('./migrations/', import.meta.url)),
};

const LOCK_KEY = 'derp_migrations';

/**
 * Lefuttatja a még nem alkalmazott `*.sql` migrációkat a megadott sorrendben (a mag, majd a modulok
 * függőségi sorrendben — ezt a sorrendet a hívó adja). Fájlonként egy tranzakció; tanácsadó zár véd
 * a párhuzamos futtatás ellen. Visszaadja az alkalmazott migrációk `scope/név` listáját.
 */
export async function runMigrations(pool: pg.Pool, sources: MigrationSource[]): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        scope text NOT NULL,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, name)
      )`);
    for (const source of sources) {
      const done = new Set(
        (await client.query<{ name: string }>('SELECT name FROM schema_migrations WHERE scope = $1', [source.scope]))
          .rows.map((r) => r.name),
      );
      const files = (await readdir(source.dir)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (done.has(file)) continue;
        const sql = await readFile(join(source.dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (scope, name) VALUES ($1, $2)', [source.scope, file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migráció sikertelen: ${source.scope}/${file}: ${(err as Error).message}`, { cause: err });
        }
        applied.push(`${source.scope}/${file}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}
