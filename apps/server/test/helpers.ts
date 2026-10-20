import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { loadConfig, type Config } from '../src/core/config.ts';
import { createDb, createPool, type Db } from '../src/core/db.ts';
import { seedModules } from '../src/core/module-host.ts';
import { loadModules } from '../src/core/modules.ts';
import { seedE2E } from '../src/core/seed.ts';

export const ADMIN_EMAIL = 'admin@derp.test';
export const IRODA_EMAIL = 'iroda@derp.test';
export const TEREPES_EMAIL = 'terepes@derp.test';

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  db: Db;
  config: Config;
  close: () => Promise<void>;
}

export type TestAppOptions = Pick<AppOptions, 'modulesDir' | 'streamPingMs' | 'googleFetch' | 'googleEndpoints'>;

export async function createTestApp(env: Record<string, string> = {}, opts: TestAppOptions = {}): Promise<TestContext> {
  const config = loadConfig({
    DATABASE_URL: inject('databaseUrl'),
    SESSION_SECRET: 'x'.repeat(32),
    NODE_ENV: 'test',
    DEV_LOGIN: '1',
    ...env,
  });
  const pool = createPool(config.databaseUrl);
  const db = createDb(pool);
  let app: FastifyInstance;
  try {
    await seedE2E(db);
    await seedModules(await loadModules(config.modules, opts.modulesDir), db, pool);
    app = await buildApp({ config, pool, logger: false, webRoot: null, ...opts });
  } catch (err) {
    await pool.end();
    throw err;
  }
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

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Kérés egy munkamenet-sütivel (vagy anélkül). */
export const requester =
  (app: FastifyInstance, cookie?: string) =>
  (method: Method, url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
