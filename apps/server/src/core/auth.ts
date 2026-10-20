import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DevLoginBody, SessionInfo, User } from '@derp/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { unauthorized } from './errors.ts';
import { sessions, users } from './schema.ts';

export const SESSION_COOKIE = 'derp_session';
const SESSION_DAYS = 30;

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

async function userForToken(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

/** preHandler: csak bejelentkezett felhasználót enged tovább. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.user) throw unauthorized();
}

/**
 * Munkamenet-kezelés és belépési végpontok. Közvetlenül az alkalmazásra kerül (nem `register`-rel),
 * hogy az `onRequest` hook minden útvonalon beállítsa a `req.user`-t.
 */
export function registerAuth(app: FastifyInstance, opts: { db: Db; config: Config }): void {
  const { db, config } = opts;
  const secure = config.publicBaseUrl.startsWith('https://');

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    req.user = await userForToken(db, unsigned.value);
  });

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      signed: true,
      expires: expiresAt,
    });

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/api/session', { schema: { response: { 200: SessionInfo } } }, async (req) => ({
    user: req.user,
    devLogin: config.devLogin,
    tzDisplay: config.tzDisplay,
  }));

  r.post('/api/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value) {
      await db.delete(sessions).where(eq(sessions.id, hashToken(unsigned.value)));
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  if (config.devLogin) {
    // Jelszó nélküli belépés egy már felvett felhasználóval; csak teszt- és fejlesztői környezetben.
    r.post(
      '/api/dev-login',
      { schema: { body: DevLoginBody, response: { 200: z.object({ user: User }) } } },
      async (req, reply) => {
        const [user] = await db
          .select({ id: users.id, email: users.email, name: users.name, role: users.role })
          .from(users)
          .where(eq(sql`lower(${users.email})`, req.body.email.toLowerCase()))
          .limit(1);
        if (!user) throw unauthorized('Ismeretlen felhasználó');
        const { token, expiresAt } = await createSession(db, user.id);
        setSessionCookie(reply, token, expiresAt);
        return { user };
      },
    );
  }
}
