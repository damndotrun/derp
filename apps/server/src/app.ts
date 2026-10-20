import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { registerAuth, requireUser } from './core/auth.ts';
import type { Config } from './core/config.ts';
import { createDb } from './core/db.ts';
import { HttpError } from './core/errors.ts';
import { healthRoutes } from './core/health.ts';
import { projectRoutes } from './core/projects.ts';
import { staticRoutes, WEB_DIST } from './core/static.ts';

export interface AppOptions {
  config: Config;
  pool: pg.Pool;
  logger?: boolean;
  webRoot?: string | null;
}

export async function buildApp({ config, pool, logger = true, webRoot = WEB_DIST }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: config.nodeEnv === 'test' ? 'warn' : 'info' } : false });
  const db = createDb(pool);

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
  registerAuth(app, { db, config });
  await app.register(async (protectedScope) => {
    protectedScope.addHook('preHandler', requireUser);
    await protectedScope.register(projectRoutes, { db });
  });
  if (webRoot) await app.register(staticRoutes, { root: webRoot });

  return app;
}
