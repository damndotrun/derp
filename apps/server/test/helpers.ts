import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/core/config.ts';
import { createDb, createPool, type Db } from '../src/core/db.ts';
import { seedE2E } from '../src/core/seed.ts';

export const ADMIN_EMAIL = 'admin@derp.test';

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  db: Db;
  config: Config;
  close: () => Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  const config = loadConfig({
    DATABASE_URL: inject('databaseUrl'),
    SESSION_SECRET: 'x'.repeat(32),
    NODE_ENV: 'test',
    DEV_LOGIN: '1',
    ...env,
  });
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  await seedE2E(db);
  const app = await buildApp({ config, pool, logger: false, webRoot: null });
  return {
    app,
    pool,
    db,
    config,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Dev-loginnal belép, és visszaadja a munkamenet-sütit. */
export async function login(app: FastifyInstance, email = ADMIN_EMAIL): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/dev-login', payload: { email } });
  if (res.statusCode !== 200) throw new Error(`dev-login: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'derp_session');
  if (!cookie) throw new Error('nincs munkamenet-süti');
  return `${cookie.name}=${cookie.value}`;
}
