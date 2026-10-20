import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GoogleEndpoints } from '../src/core/google-oidc.ts';
import { createTestApp, IRODA_EMAIL, requester, type TestContext } from './helpers.ts';

// A Google mockolt válaszokkal: a teszt maga a „Google”: aláírja az ID tokent, kiszolgálja a JWKS-t és a kódcserét.
const CLIENT_ID = 'derp-login.apps.googleusercontent.test';
const CLIENT_SECRET = 'titkos';
const BASE = 'http://derp.test';
const endpoints: GoogleEndpoints = {
  authorization: 'https://google.test/o/oauth2/v2/auth',
  token: 'https://google.test/token',
  jwks: 'https://google.test/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};

const keyPair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const google = keyPair();
const stranger = keyPair();
const KID = 'kulcs-1';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(claims: Record<string, unknown>, key: KeyObject = google.privateKey, kid = KID): string {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

/** A mock „Google” állapota egy próbához. */
interface Scenario {
  /** Az ID token claimjeinek felülírása (a nonce-ot a kérésből veszi). */
  claims?: Record<string, unknown>;
  signingKey?: KeyObject;
  tokenStatus?: number;
}
let scenario: Scenario = {};
let lastNonce = '';
let lastChallenge = '';
const tokenRequests: URLSearchParams[] = [];
let jwksFetches = 0;

const googleFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === endpoints.jwks) {
    jwksFetches++;
    const jwk = { ...google.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
    return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } });
  }
  if (url === endpoints.token && init?.method === 'POST') {
    const form = new URLSearchParams(String(init.body));
    tokenRequests.push(form);
    if (scenario.tokenStatus) return Response.json({ error: 'invalid_grant' }, { status: scenario.tokenStatus });
    // PKCE: a verifier hash-e egyezzen az átirányításkor küldött challenge-dzsel.
    if (createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== lastChallenge) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = signJwt(
      {
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: '1234567890',
        email: IRODA_EMAIL,
        email_verified: true,
        name: 'Iroda Ildi',
        nonce: lastNonce,
        iat: now,
        exp: now + 3600,
        ...scenario.claims,
      },
      scenario.signingKey,
    );
    return Response.json({ access_token: 'x', id_token: idToken, token_type: 'Bearer', expires_in: 3599 });
  }
  return new Response('nem várt kérés', { status: 500 });
}) as typeof fetch;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp(
    { DEV_LOGIN: '0', PUBLIC_BASE_URL: BASE, GOOGLE_LOGIN_CLIENT_ID: CLIENT_ID, GOOGLE_LOGIN_CLIENT_SECRET: CLIENT_SECRET },
    { googleFetch, googleEndpoints: endpoints },
  );
});
afterAll(() => ctx.close());
beforeEach(() => {
  scenario = {};
});

/** Végigjátssza a belépést: indítás → (Google) → visszatérés. A visszatérés válaszát adja. */
async function loginFlow(opts: { state?: string; withCookie?: boolean; query?: string } = {}) {
  const start = await ctx.app.inject({ method: 'GET', url: '/api/auth/google' });
  expect(start.statusCode).toBe(302);
  const auth = new URL(start.headers.location as string);
  lastNonce = auth.searchParams.get('nonce')!;
  lastChallenge = auth.searchParams.get('code_challenge')!;
  const flowCookie = start.cookies.find((c) => c.name === 'derp_oidc')!;
  const state = opts.state ?? auth.searchParams.get('state')!;
  return ctx.app.inject({
    method: 'GET',
    url: `/api/auth/google/callback?${opts.query ?? `code=kod-123&state=${encodeURIComponent(state)}`}`,
    headers: opts.withCookie === false ? {} : { cookie: `derp_oidc=${flowCookie.value}` },
  });
}

describe('Google OIDC belépés (mockolt Google)', () => {
  it('az indítás a Google-re irányít a szükséges paraméterekkel', async () => {
    const start = await ctx.app.inject({ method: 'GET', url: '/api/auth/google' });
    const auth = new URL(start.headers.location as string);
    expect(`${auth.origin}${auth.pathname}`).toBe(endpoints.authorization);
    expect(Object.fromEntries(auth.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: `${BASE}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
    });
    expect(auth.searchParams.get('state')).toBeTruthy();
    expect(auth.searchParams.get('nonce')).toBeTruthy();
    const cookie = start.cookies.find((c) => c.name === 'derp_oidc')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/auth/google', maxAge: 600 });
  });

  it('felvett e-mail-címmel belép (kis- és nagybetűtől függetlenül), munkamenetet kap, a belépés naplózott', async () => {
    scenario = { claims: { email: 'IRODA@derp.test' } };
    const res = await loginFlow();
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const session = res.cookies.find((c) => c.name === 'derp_session')!;
    const me = await requester(ctx.app, `derp_session=${session.value}`)('GET', '/api/session');
    expect(me.json()).toMatchObject({ user: { email: IRODA_EMAIL, role: 'iroda' }, devLogin: false, googleLogin: true });

    const form = tokenRequests.at(-1)!;
    expect(Object.fromEntries(form)).toMatchObject({
      code: 'kod-123',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: `${BASE}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    });
    const { rows } = await ctx.pool.query(
      "SELECT data FROM audit_log WHERE action = 'login' AND entity_id = (SELECT id::text FROM users WHERE email = $1) ORDER BY id DESC LIMIT 1",
      [IRODA_EMAIL],
    );
    expect(rows[0].data).toEqual({ method: 'google' });
  });

  it('nem felvett címmel nem lép be', async () => {
    scenario = { claims: { email: 'idegen@gmail.com' } };
    const res = await loginFlow();
    expect(res.headers.location).toBe('/login?error=not_allowed');
    expect(res.cookies.find((c) => c.name === 'derp_session')).toBeUndefined();
  });

  it('kikapcsolt felhasználó nem lép be', async () => {
    await ctx.pool.query("INSERT INTO users (email, name, role, deactivated_at) VALUES ('ki@derp.test', 'Ki', 'iroda', now())");
    scenario = { claims: { email: 'ki@derp.test' } };
    expect((await loginFlow()).headers.location).toBe('/login?error=not_allowed');
  });

  it.each<[string, Scenario]>([
    ['idegen címzett (aud)', { claims: { aud: 'mas-kliens' } }],
    ['lejárt token', { claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }],
    ['eltérő nonce', { claims: { nonce: 'hamis' } }],
    ['nem ellenőrzött e-mail', { claims: { email_verified: false } }],
    ['idegen kibocsátó', { claims: { iss: 'https://evil.test' } }],
    ['idegen kulccsal aláírt token', { signingKey: stranger.privateKey }],
    ['sikertelen kódcsere', { tokenStatus: 400 }],
  ])('%s → hiba, nincs munkamenet', async (_name, s) => {
    scenario = s;
    const res = await loginFlow();
    expect(res.headers.location).toBe('/login?error=google_failed');
    expect(res.cookies.find((c) => c.name === 'derp_session')).toBeUndefined();
  });

  it('eltérő state vagy hiányzó folyamat-süti → hiba', async () => {
    expect((await loginFlow({ state: 'hamis' })).headers.location).toBe('/login?error=google_failed');
    expect((await loginFlow({ withCookie: false })).headers.location).toBe('/login?error=google_failed');
  });

  it('a felhasználó megszakította a Google-on', async () => {
    expect((await loginFlow({ query: 'error=access_denied' })).headers.location).toBe('/login?error=google_cancelled');
  });

  it('a JWKS-t gyorsítótárazza', async () => {
    const before = jwksFetches;
    await loginFlow();
    await loginFlow();
    expect(jwksFetches).toBe(before);
  });

  it('beállítás nélkül a végpont nincs regisztrálva, és a session jelzi', async () => {
    const other = await createTestApp();
    try {
      expect((await other.app.inject({ method: 'GET', url: '/api/auth/google' })).statusCode).toBe(404);
      expect((await other.app.inject({ method: 'GET', url: '/api/session' })).json().googleLogin).toBe(false);
    } finally {
      await other.close();
    }
  });
});
