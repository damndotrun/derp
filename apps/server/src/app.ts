import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { auditRoutes } from './core/audit.ts';
import { registerAuth, requireUser } from './core/auth.ts';
import { clientRoutes } from './core/clients.ts';
import type { Config } from './core/config.ts';
import { createDb } from './core/db.ts';
import { HttpError } from './core/errors.ts';
import type { FetchFn, GoogleEndpoints } from './core/google-oidc.ts';
import { healthRoutes } from './core/health.ts';
import { createModuleContext, moduleListRoutes } from './core/module-host.ts';
import { loadModules, MODULES_DIR, type LoadedModule } from './core/modules.ts';
import { privacyRoutes } from './core/privacy.ts';
import { projectRoutes } from './core/projects.ts';
import { staticRoutes, WEB_DIST } from './core/static.ts';
import { EventHub, PING_MS, streamRoutes } from './core/stream.ts';
import { testRoutes } from './core/test-routes.ts';
import { userRoutes } from './core/users.ts';

export interface AppOptions {
  config: Config;
  pool: pg.Pool;
  logger?: boolean;
  webRoot?: string | null;
  /** A modulok könyvtára (tesztben felülírható). */
  modulesDir?: string;
  /** Az SSE-ping gyakorisága (tesztben rövidebb). */
  streamPingMs?: number;
  /** A Google-belépés kérései (tesztben mockolt válaszokkal). */
  googleFetch?: FetchFn;
  googleEndpoints?: GoogleEndpoints;
}

export async function buildApp({
  config,
  pool,
  logger = true,
  webRoot = WEB_DIST,
  modulesDir = MODULES_DIR,
  streamPingMs = PING_MS,
  googleFetch,
  googleEndpoints,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: config.nodeEnv === 'test' ? 'warn' : 'info' } : false });
  const db = createDb(pool);
  const modules: LoadedModule[] = await loadModules(config.modules, modulesDir);
  app.log.info({ modules: modules.map((m) => m.manifest.id) }, 'bekapcsolt modulok');

  const hub = new EventHub(db, config.databaseUrl, app.log);
  await hub.start();
  app.addHook('preClose', async () => hub.closeStreams());
  app.addHook('onClose', async () => hub.stop());

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: { code: 'validation', message: err.validation.map((v) => `${v.instancePath || '/'} ${v.message}`).join('; ') },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Belső hiba' } });
  });

  await app.register(fastifyCookie, { secret: config.sessionSecret });
  await app.register(healthRoutes, { pool });
  await app.register(privacyRoutes);
  await registerAuth(app, { db, config, googleFetch, googleEndpoints });
  await app.register(async (protectedScope) => {
    protectedScope.addHook('preHandler', requireUser);
    await protectedScope.register(projectRoutes, { db });
    await protectedScope.register(clientRoutes, { db });
    await protectedScope.register(userRoutes, { db, onUserChanged: (id) => hub.closeUserStreams(id) });
    await protectedScope.register(auditRoutes, { db });
    await protectedScope.register(moduleListRoutes, { modules });
    await protectedScope.register(streamRoutes, { db, hub, pingMs: streamPingMs });
    if (config.nodeEnv === 'test') await protectedScope.register(testRoutes, { db });
    for (const m of modules) {
      const { routes } = m.manifest;
      if (routes) await protectedScope.register(async (scope) => routes(scope, createModuleContext(m, db, pool, config)));
    }
  });
  for (const m of modules) {
    const { publicRoutes } = m.manifest;
    if (publicRoutes) await app.register(async (scope) => publicRoutes(scope, createModuleContext(m, db, pool, config)));
  }
  if (webRoot) await app.register(staticRoutes, { root: webRoot });

  return app;
}
