import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './core/config.ts';
import { createPool } from './core/db.ts';

const PORT = 8080;

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const app = await buildApp({ config, pool });

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ host: '0.0.0.0', port: PORT });
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
