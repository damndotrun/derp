import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
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

describe('0003_access: a szöveges ügyfélmező kiváltása', () => {
  it('a meglévő projektek ügyfélneveiből ügyfelek lesznek, a projekt rájuk hivatkozik', async () => {
    const name = `derp_mig_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: inject('databaseUrl') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(inject('databaseUrl'));
    url.pathname = `/${name}`;
    const fresh = createPool(url.toString());
    try {
      // A 2b előtti állapot: csak a 0001 és 0002.
      const dir = await mkdtemp(join(tmpdir(), 'derp-core-'));
      for (const f of ['0001_core_init.sql', '0002_events_stream.sql']) await copyFile(join(CORE_MIGRATIONS.dir, f), join(dir, f));
      await runMigrations(fresh, [{ scope: 'core', dir }]);
      await fresh.query(`INSERT INTO projects (name, client_name) VALUES
        ('A', 'Minta Kft.'), ('B', ' Minta Kft. '), ('C', 'Másik Bt.'), ('D', '')`);

      expect(await runMigrations(fresh, [CORE_MIGRATIONS])).toContain('core/0003_access.sql');
      const { rows } = await fresh.query(
        'SELECT p.name, c.name AS client FROM projects p LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name',
      );
      expect(rows).toEqual([
        { name: 'A', client: 'Minta Kft.' },
        { name: 'B', client: 'Minta Kft.' },
        { name: 'C', client: 'Másik Bt.' },
        { name: 'D', client: null },
      ]);
      expect((await fresh.query('SELECT count(*)::int AS n FROM clients')).rows[0].n).toBe(2);
    } finally {
      await fresh.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
