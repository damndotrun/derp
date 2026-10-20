import { z } from 'zod';
import { DerpModules } from './core/config.ts';
import { createDb, createPool } from './core/db.ts';
import { CORE_MIGRATIONS, runMigrations } from './core/migrate.ts';
import { seedModules } from './core/module-host.ts';
import { loadModules, migrationSources, ModuleError } from './core/modules.ts';
import { seedE2E } from './core/seed.ts';

// A CLI csak az adatbázist és a bekapcsolt modulokat használja, a többi konfigurációt nem kéri.
const env = z
  .object({ DATABASE_URL: z.string({ error: 'DATABASE_URL kötelező' }).min(1, 'DATABASE_URL kötelező'), DERP_MODULES: DerpModules })
  .safeParse(process.env);
if (!env.success) {
  console.error(env.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const command = process.argv[2];
const pool = createPool(env.data.DATABASE_URL);

try {
  const modules = await loadModules(env.data.DERP_MODULES);
  const sources = migrationSources(CORE_MIGRATIONS, modules);
  switch (command) {
    case 'migrate': {
      const applied = await runMigrations(pool, sources);
      console.log(applied.length ? `Alkalmazva: ${applied.join(', ')}` : 'Nincs új migráció');
      break;
    }
    case 'seed:e2e': {
      await runMigrations(pool, sources);
      const db = createDb(pool);
      await seedE2E(db);
      await seedModules(modules, db, pool);
      console.log(`E2E tesztadatok betöltve (modulok: ${modules.map((m) => m.manifest.id).join(', ') || '–'})`);
      break;
    }
    default:
      console.error('Használat: cli.ts <migrate|seed:e2e>');
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof ModuleError ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
