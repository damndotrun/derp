import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

// Google OpenID Connect belépés (authorization code flow, PKCE-vel), külső függőség nélkül. A visszatérési cím
// `${PUBLIC_BASE_URL}/api/auth/google/callback`; ezt kell a Google Cloud „dERP login” kliensénél engedélyezni.

export interface GoogleEndpoints {
  authorization: string;
  token: string;
  jwks: string;
  issuers: string[];
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};

export const CALLBACK_PATH = '/api/auth/google/callback';
const FLOW_COOKIE = 'derp_oidc';
const FLOW_MAX_AGE_S = 600;
/** Megengedett óraeltérés a tokenidőkben. */
const CLOCK_SKEW_S = 60;
const JWKS_DEFAULT_TTL_MS = 3600_000;
/** Ismeretlen `kid` esetén legfeljebb ilyen gyakran töltjük újra a kulcsokat. */
const JWKS_MIN_REFRESH_MS = 60_000;

export type FetchFn = typeof fetch;

export class OidcError extends Error {}

/** A Google aláíró kulcsai (JWKS) gyorsítótárral; a `Cache-Control: max-age` szerint, ismeretlen `kid`-nél újratölt. */
export class JwksCache {
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private lastFetch = 0;
  private readonly url: string;
  private readonly fetchFn: FetchFn;

  constructor(url: string, fetchFn: FetchFn) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  async get(kid: string): Promise<KeyObject> {
    const now = Date.now();
    if (now >= this.expiresAt || (!this.keys.has(kid) && now - this.lastFetch >= JWKS_MIN_REFRESH_MS)) await this.refresh();
    const key = this.keys.get(kid);
    if (!key) throw new OidcError(`ismeretlen aláíró kulcs: ${kid}`);
    return key;
  }

  private async refresh(): Promise<void> {
    this.lastFetch = Date.now();
    const res = await this.fetchFn(this.url);
    if (!res.ok) throw new OidcError(`JWKS letöltése sikertelen: ${res.status}`);
    const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string; kty?: string }> };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kid && jwk.kty === 'RSA') keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    this.keys = keys;
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
    this.expiresAt = Date.now() + (maxAge ? Number(maxAge) * 1000 : JWKS_DEFAULT_TTL_MS);
  }
}

export interface IdTokenClaims {
  email: string;
  name?: string;
  sub: string;
}

const Claims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  azp: z.string().optional(),
  sub: z.string(),
  exp: z.number(),
  iat: z.number(),
  nonce: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.literal('true'), z.literal('false')]).optional(),
  name: z.string().optional(),
});

const decodePart = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Az ID token ellenőrzése: RS256-aláírás a Google kulcsával, kibocsátó, címzett, lejárat, nonce, ellenőrzött e-mail. */
export async function verifyIdToken(
  idToken: string,
  opts: { jwks: JwksCache; clientId: string; nonce: string; issuers: string[]; now?: number },
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('hibás ID token');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let raw: unknown;
  try {
    header = decodePart(h) as typeof header;
    raw = decodePart(p);
  } catch {
    throw new OidcError('hibás ID token');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new OidcError(`nem támogatott aláírás: ${header.alg}`);
  const key = await opts.jwks.get(header.kid);
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
    throw new OidcError('érvénytelen aláírás');
  }
  const parsed = Claims.safeParse(raw);
  if (!parsed.success) throw new OidcError('hiányos ID token');
  const c = parsed.data;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!opts.issuers.includes(c.iss)) throw new OidcError(`idegen kibocsátó: ${c.iss}`);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(opts.clientId) || (aud.length > 1 && c.azp !== opts.clientId)) throw new OidcError('idegen címzett');
  if (c.exp + CLOCK_SKEW_S < now) throw new OidcError('lejárt ID token');
  if (c.iat - CLOCK_SKEW_S > now) throw new OidcError('jövőbeli ID token');
  if (c.nonce !== opts.nonce) throw new OidcError('eltérő nonce');
  if (!c.email || (c.email_verified !== true && c.email_verified !== 'true')) throw new OidcError('nincs ellenőrzött e-mail-cím');
  return { email: c.email, name: c.name, sub: c.sub };
}

const Flow = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() });
type Flow = z.infer<typeof Flow>;

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export interface GoogleLoginOptions {
  clientId: string;
  clientSecret: string;
  publicBaseUrl: string;
  secure: boolean;
  fetch: FetchFn;
  endpoints: GoogleEndpoints;
  /**
   * Belépteti a felhasználót az ellenőrzött e-mail-címe alapján (munkamenet + süti); `false`, ha a cím nincs felvéve
   * vagy a felhasználó ki van kapcsolva.
   */
  signIn: (reply: FastifyReply, email: string) => Promise<boolean>;
}

/**
 * `GET /api/auth/google`: átirányít a Google-re (state, nonce, PKCE egy rövid életű, aláírt sütiben).
 * `GET /api/auth/google/callback`: kódcsere, ID token ellenőrzése, belépés; utána a főoldalra, hibánál a
 * `/login?error=<kód>` oldalra irányít (`google_cancelled`, `google_failed`, `not_allowed`).
 */
export async function googleLoginRoutes(app: FastifyInstance, opts: GoogleLoginOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const jwks = new JwksCache(opts.endpoints.jwks, opts.fetch);
  const redirectUri = `${opts.publicBaseUrl}${CALLBACK_PATH}`;
  const cookieOpts = { path: '/api/auth/google', httpOnly: true, sameSite: 'lax' as const, secure: opts.secure, signed: true };

  r.get('/api/auth/google', async (_req, reply) => {
    const flow: Flow = {
      state: randomBytes(16).toString('base64url'),
      nonce: randomBytes(16).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
    };
    reply.setCookie(FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString('base64url'), { ...cookieOpts, maxAge: FLOW_MAX_AGE_S });
    const url = new URL(opts.endpoints.authorization);
    url.search = new URLSearchParams({
      client_id: opts.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return reply.redirect(url.toString());
  });

  r.get(CALLBACK_PATH, { schema: { querystring: CallbackQuery } }, async (req, reply) => {
    const fail = (code: string) => reply.redirect(`/login?error=${code}`);
    const raw = req.cookies[FLOW_COOKIE];
    reply.clearCookie(FLOW_COOKIE, { path: cookieOpts.path });
    if (req.query.error) return fail('google_cancelled');

    const unsigned = raw ? req.unsignCookie(raw) : null;
    let flow: Flow | null = null;
    if (unsigned?.valid && unsigned.value) {
      try {
        flow = Flow.parse(JSON.parse(Buffer.from(unsigned.value, 'base64url').toString('utf8')));
      } catch {
        flow = null;
      }
    }
    if (!flow || !req.query.code || req.query.state !== flow.state) {
      req.log.warn('Google-belépés: hiányzó vagy eltérő state');
      return fail('google_failed');
    }

    let claims: IdTokenClaims;
    try {
      const res = await opts.fetch(opts.endpoints.token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }).toString(),
      });
      const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
      if (!res.ok || !body.id_token) throw new OidcError(`kódcsere sikertelen: ${res.status} ${body.error ?? ''}`.trim());
      claims = await verifyIdToken(body.id_token, {
        jwks,
        clientId: opts.clientId,
        nonce: flow.nonce,
        issuers: opts.endpoints.issuers,
      });
    } catch (err) {
      req.log.warn({ err: err instanceof OidcError ? err.message : err }, 'Google-belépés sikertelen');
      return fail('google_failed');
    }

    if (!(await opts.signIn(reply, claims.email))) {
      req.log.info('Google-belépés: a cím nincs felvéve vagy ki van kapcsolva');
      return fail('not_allowed');
    }
    return reply.redirect('/');
  });
}
