import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const WEB_DIST = fileURLToPath(new URL('../../../web/dist/', import.meta.url));

/** A kliens buildjét szolgálja ki; ismeretlen nem-API útvonalra az index.html megy (SPA). */
export async function staticRoutes(app: FastifyInstance, opts: { root: string }): Promise<void> {
  if (!existsSync(opts.root)) {
    app.log.warn({ root: opts.root }, 'a kliens buildje nem található, csak az API fut');
    return;
  }
  await app.register(fastifyStatic, { root: opts.root, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Nem található' } });
  });
}
