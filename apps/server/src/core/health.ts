import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export async function healthRoutes(app: FastifyInstance, opts: { pool: pg.Pool }): Promise<void> {
  // A konténer-healthcheck 30 mp-enként hívja; csak hibát naplózunk.
  app.get('/api/health', { logLevel: 'warn' }, async (_req, reply) => {
    try {
      await opts.pool.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error', db: 'unreachable' });
    }
  });
}
