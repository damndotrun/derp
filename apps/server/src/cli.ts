import { z } from 'zod';
import { createDb, createPool } from './core/db.ts';
import { CORE_MIGRATIONS, runMigrations } from './core/migrate.ts';
import { seedE2E } from './core/seed.ts';

// A CLI csak az adatbázist használja, a többi konfigurációt nem kéri.
const databaseUrl = z.string().min(1, 'DATABASE_URL kötelező').safeParse(process.env.DATABASE_URL);
if (!databaseUrl.success) {
  console.error('DATABASE_URL kötelező');
  process.exit(1);
}

const command = process.argv[2];
const pool = createPool(databaseUrl.data);

try {
  switch (command) {
    case 'migrate': {
      const applied = await runMigrations(pool, [CORE_MIGRATIONS]);
      console.log(applied.length ? `Alkalmazva: ${applied.join(', ')}` : 'Nincs új migráció');
      break;
    }
    case 'seed:e2e': {
      await runMigrations(pool, [CORE_MIGRATIONS]);
      await seedE2E(createDb(pool));
      console.log('E2E tesztadatok betöltve');
      break;
    }
    default:
      console.error('Használat: cli.ts <migrate|seed:e2e>');
      process.exitCode = 1;
  }
} finally {
  await pool.end();
}
