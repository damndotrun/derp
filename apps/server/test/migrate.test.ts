import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createPool } from '../src/core/db.ts';
import { CORE_MIGRATIONS, runMigrations } from '../src/core/migrate.ts';

const pool = createPool(inject('databaseUrl'));
afterAll(() => pool.end());

describe('runMigrations', () => {
  it('a már alkalmazott mag-migrációkat nem futtatja újra', async () => {
    expect(await runMigrations(pool, [CORE_MIGRATIONS])).toEqual([]);
    const { rows } = await pool.query("SELECT name FROM schema_migrations WHERE scope = 'core'");
    expect(rows.map((r) => r.name)).toContain('0001_core_init.sql');
  });

  it('forrásonként és fájlnév szerint sorban fut, és hibánál visszagörget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'derp-mig-'));
    await writeFile(join(dir, '0002_b.sql'), 'INSERT INTO mig_probe VALUES (2);');
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE mig_probe (n int);');
    await writeFile(join(dir, 'README.md'), 'nem migráció');
    expect(await runMigrations(pool, [CORE_MIGRATIONS, { scope: 'probe', dir }])).toEqual([
      'probe/0001_a.sql',
      'probe/0002_b.sql',
    ]);

    await writeFile(join(dir, '0003_bad.sql'), 'INSERT INTO mig_probe VALUES (3); SELECT * FROM nincs_ilyen;');
    await expect(runMigrations(pool, [{ scope: 'probe', dir }])).rejects.toThrow(/probe\/0003_bad\.sql/);
    const { rows } = await pool.query('SELECT n FROM mig_probe ORDER BY n');
    expect(rows.map((r) => r.n)).toEqual([2]);
  });
});
