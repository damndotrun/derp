import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export async function healthRoutes(app: FastifyInstance, opts: { pool: pg.Pool }): Promise<void> {
  app.get('/api/health', async (_req, reply) => {
    try {
      await opts.pool.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error', db: 'unreachable' });
    }
  });
}
