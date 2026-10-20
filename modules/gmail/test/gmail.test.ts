import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleSeedContext } from '@derp/server/module-api';
import { appendEvent } from '../../../apps/server/src/core/events.ts';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from '../../../apps/server/test/helpers.ts';
import type { AccountList, MessageDetail, Rule, RuleList, ThreadDetail, ThreadList } from '../shared.ts';
import { addAccount } from '../server/accounts.ts';
import { createSource, mailSourceKind } from '../server/mail-source.ts';
import { MockMailSource, type FixtureMessage } from '../server/mock-source.ts';
import { E2E_ACCOUNT } from '../server/seed.ts';
import { BACKFILL_DAYS, syncAccount, type SyncDeps } from '../server/sync.ts';

let ctx: TestContext;
let admin: string;
let iroda: string;
let terepes: string;
let terepesId: string;

beforeAll(async () => {
  ctx = await createTestApp({ DERP_MODULES: 'gmail' });
  admin = await login(ctx.app);
  iroda = await login(ctx.app, IRODA_EMAIL);
  terepes = await login(ctx.app, TEREPES_EMAIL);
  const users = (await requester(ctx.app, admin)('GET', '/api/users')).json().items as Array<{ id: string; email: string }>;
  terepesId = users.find((u) => u.email === TEREPES_EMAIL)!.id;
});
afterAll(async () => {
  await ctx.close();
});

const as = (cookie: string) => requester(ctx.app, cookie);
const append: ModuleSeedContext['appendEvent'] = (e, tx) => appendEvent(tx ?? ctx.db, e);
const deps = (source: MockMailSource): SyncDeps => ({ db: ctx.db, appendEvent: append, source });
const one = async <T>(q: ReturnType<typeof sql>): Promise<T> => (await ctx.db.execute(q)).rows[0] as T;

async function project(name: string, members: string[] = []): Promise<string> {
  const p = (await as(admin)('POST', '/api/projects', { name })).json();
  for (const m of members) expect((await as(admin)('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

async function account(email: string): Promise<{ id: string; email: string; historyId: string | null }> {
  const id = await addAccount(ctx.db, { email, source: 'mock', userId: null });
  return { id: id!, email, historyId: null };
}
const historyOf = async (accountId: string) =>
  (await one<{ history_id: string | null }>(sql`SELECT history_id FROM gmail_accounts WHERE id = ${accountId}`)).history_id;
const countOf = async (accountId: string) =>
  (
    await one<{ n: number; distinct: number }>(
      sql`SELECT count(*)::int AS n, count(DISTINCT gmail_message_id)::int AS distinct FROM gmail_messages WHERE account_id = ${accountId}`,
    )
  );

const msg = (id: string, over: Partial<FixtureMessage> = {}): FixtureMessage => ({
  id,
  threadId: `t-${id}`,
  minutesAgo: 0,
  from: 'Valaki <valaki@kulso.test>',
  to: ['levelek@derp.test'],
  subject: `Teszt ${id}`,
  body: 'Helyszíni egyeztetés időpont',
  ...over,
});

describe('gmail: forrás kiválasztása', () => {
  it('a MAIL_SOURCE alapból mock; ismeretlen értékre és a még nem kész élő forrásra hibát ad', () => {
    expect(mailSourceKind({})).toBe('mock');
    expect(mailSourceKind({ MAIL_SOURCE: 'gmail' })).toBe('gmail');
    expect(() => mailSourceKind({ MAIL_SOURCE: 'imap' })).toThrow(/MAIL_SOURCE/);
    expect(() => createSource('gmail')).toThrow(/14\. munkacsomag/);
  });
});

describe('gmail: betöltés a mock-forrásból', () => {
  it('első alkalommal 90 napra visszamenőleg tölt be; utána a historyId óta érkezetteket, duplikáció nélkül', async () => {
    const now = new Date();
    const source = new MockMailSource(
      [
        msg('regi', { minutesAgo: (BACKFILL_DAYS + 1) * 1440 }),
        msg('uj-1', { threadId: 't-ketto', minutesAgo: 60 }),
        msg('uj-2', { threadId: 't-ketto', minutesAgo: 30, from: 'Iroda <levelek@derp.test>', labelIds: ['SENT'] }),
      ],
      now,
    );
    const a = await account('betoltes@derp.test');

    const first = await syncAccount(deps(source), a);
    expect(first).toMatchObject({ mode: 'backfill', fetched: 2, inserted: 2 });
    expect(await historyOf(a.id)).toBe('3');
    const thread = await one<{ subject: string; n: number }>(
      sql`SELECT t.subject, (SELECT count(*)::int FROM gmail_messages m WHERE m.thread_id = t.id) AS n
          FROM gmail_threads t WHERE t.account_id = ${a.id} AND t.gmail_thread_id = 't-ketto'`,
    );
    expect(thread).toEqual({ subject: 'Teszt uj-1', n: 2 });
    const out = await one<{ direction: string }>(sql`SELECT direction FROM gmail_messages WHERE account_id = ${a.id} AND gmail_message_id = 'uj-2'`);
    expect(out.direction).toBe('out');

    source.deliver(msg('uj-3', { threadId: 't-ketto' }));
    const second = await syncAccount(deps(source), { ...a, historyId: await historyOf(a.id) });
    expect(second).toMatchObject({ mode: 'history', fetched: 1, inserted: 1 });
    const third = await syncAccount(deps(source), { ...a, historyId: await historyOf(a.id) });
    expect(third).toMatchObject({ mode: 'history', fetched: 0, inserted: 0 });
    expect(await countOf(a.id)).toEqual({ n: 3, distinct: 3 });
  });

  it('elévült historyId → újrabetöltés az utolsó ismert levél dátumától, duplikáció nélkül (levélben és eseményben sem)', async () => {
    const source = new MockMailSource([msg('e-1', { threadId: 't-e', minutesAgo: 600 }), msg('e-2', { threadId: 't-e', minutesAgo: 20 })]);
    const a = await account('elevult@derp.test');
    await syncAccount(deps(source), a);
    const pid = await project('Gmail: elévülés');
    const threadId = (await one<{ id: string }>(sql`SELECT id FROM gmail_threads WHERE account_id = ${a.id} AND gmail_thread_id = 't-e'`)).id;
    expect((await as(iroda)('PUT', `/api/gmail/threads/${threadId}/project`, { projectId: pid })).statusCode).toBe(200);

    // Közben új levelek érkeznek, és a régi historyId elévül (a Gmail history.list 404-et adna).
    source.deliver(msg('e-3', { threadId: 't-e' }));
    source.expireHistory();
    source.deliver(msg('e-4', { threadId: 't-masik' }));
    const stale = await historyOf(a.id);
    expect(stale).toBe('2');

    const reload = await syncAccount(deps(source), { ...a, historyId: stale });
    expect(reload).toMatchObject({ mode: 'reload', fetched: 2, inserted: 2 });
    expect(await historyOf(a.id)).toBe('4');
    expect(await countOf(a.id)).toEqual({ n: 4, distinct: 4 });

    // Ugyanaz újra (pl. ismét elévült): nem tölt be semmit kétszer.
    source.expireHistory();
    const again = await syncAccount(deps(source), { ...a, historyId: '1' });
    expect(again).toMatchObject({ mode: 'reload', inserted: 0 });
    expect(await countOf(a.id)).toEqual({ n: 4, distinct: 4 });

    // A projekthez rendelt szál új levele is az idővonalra került, egyszer.
    const events = (await as(iroda)('GET', `/api/projects/${pid}/events?types=gmail.message`)).json().items as Array<{ title: string; data: { messageId: string } }>;
    expect(events.map((e) => e.title)).toEqual(['Levél: Teszt e-3', 'Levél: Teszt e-2', 'Levél: Teszt e-1']);
    expect(new Set(events.map((e) => e.data.messageId)).size).toBe(3);
  });
});

describe('gmail: hozzárendeletlen levelek és hozzárendelés', () => {
  const fixtureThread = async (subject: string): Promise<string> =>
    (
      await one<{ id: string }>(
        sql`SELECT t.id FROM gmail_threads t JOIN gmail_accounts a ON a.id = t.account_id WHERE a.email = ${E2E_ACCOUNT} AND t.subject = ${subject}`,
      )
    ).id;

  it('a seed a mock-fiókba tölti a fixture-postafiókot; a listát az iroda látja, a terepes nem', async () => {
    const list = await as(iroda)('GET', '/api/gmail/threads?limit=200');
    expect(list.statusCode).toBe(200);
    const body = list.json() as ThreadList;
    const minta = body.items.find((t) => t.account === E2E_ACCOUNT && t.subject === 'Re: Minta Kft. ajánlatkérés');
    expect(minta).toMatchObject({ messageCount: 2, attachmentCount: 1, projectId: null, status: 'client_rfq_open' });
    expect(minta!.participants[0]).toContain('bela@minta-kft.test');
    const order = body.items.find((t) => t.account === E2E_ACCOUNT && t.subject === 'Megrendelés – tetőventilátor csere');
    expect(order?.status).toBe('order');
    const rfq = body.items.find((t) => t.account === E2E_ACCOUNT && t.subject === 'Kérnék ajánlatot irodai klímára');
    expect(rfq).toMatchObject({ status: 'client_rfq_reply_needed', deadline: true });

    expect((await as(terepes)('GET', '/api/gmail/threads')).statusCode).toBe(403);
    expect((await as(terepes)('GET', `/api/gmail/threads/${minta!.id}`)).statusCode).toBe(403);
    expect((await as(terepes)('GET', `/api/gmail/messages/${(await as(iroda)('GET', `/api/gmail/threads/${minta!.id}`)).json().messages[0].id}`)).statusCode).toBe(403);
  });

  it('szabály szerinti javaslat; hozzárendelés → a levelek az idővonalon, a törzs megnyitható; a terepes csak a hozzárendelt projektét látja', async () => {
    const pid = await project('Minta Kft. – légtechnika felmérés (gmail)', [terepesId]);
    const other = await project('Gmail: másik projekt');
    const rule = await as(iroda)('POST', '/api/gmail/rules', { pattern: 'csarnok légtechnika', projectId: pid });
    expect(rule.statusCode).toBe(201);

    const threadId = await fixtureThread('Re: Minta Kft. ajánlatkérés');
    const listed = ((await as(iroda)('GET', '/api/gmail/threads?limit=200')).json() as ThreadList).items.find((t) => t.id === threadId);
    expect(listed?.suggestion).toEqual({ ruleId: (rule.json() as Rule).id, projectId: pid, projectName: 'Minta Kft. – légtechnika felmérés (gmail)' });

    // A terepes nem rendelhet hozzá; a nem látható projekthez sem lehet.
    expect((await as(terepes)('PUT', `/api/gmail/threads/${threadId}/project`, { projectId: pid })).statusCode).toBe(403);

    const assigned = await as(iroda)('PUT', `/api/gmail/threads/${threadId}/project`, { projectId: pid });
    expect(assigned.statusCode).toBe(200);
    const thread = assigned.json() as ThreadDetail;
    expect(thread).toMatchObject({ projectId: pid, suggestion: null, messageCount: 2 });
    expect(thread.messages[0]!.bodyText).toContain('csarnok légtechnikai felújítására');

    // Ugyanahhoz újra: nem változik; másikhoz: 409.
    expect((await as(iroda)('PUT', `/api/gmail/threads/${threadId}/project`, { projectId: pid })).statusCode).toBe(200);
    expect((await as(iroda)('PUT', `/api/gmail/threads/${threadId}/project`, { projectId: other })).statusCode).toBe(409);
    const stillListed = ((await as(iroda)('GET', '/api/gmail/threads?limit=200')).json() as ThreadList).items.some((t) => t.id === threadId);
    expect(stillListed).toBe(false);

    const events = (await as(iroda)('GET', `/api/projects/${pid}/events?types=gmail.message`)).json().items as Array<{
      title: string;
      source: string;
      data: { messageId: string; direction: string; attachments: unknown[] };
    }>;
    expect(events.map((e) => e.title)).toEqual(['Levél: Re: Minta Kft. ajánlatkérés', 'Levél: Re: Minta Kft. ajánlatkérés']);
    expect(events.map((e) => e.data.direction)).toEqual(['out', 'in']);
    expect(events[1]!.data.attachments).toEqual([{ name: 'alaprajz_csarnok.pdf', mimeType: 'application/pdf', size: 183402 }]);
    expect(events.every((e) => e.source === 'gmail')).toBe(true);
    expect((await as(iroda)('GET', `/api/projects/${other}/events?types=gmail.message`)).json().items).toEqual([]);

    // A levél törzse: a projekthez rendelt terepes megnyithatja (auditnaplóval), a nem hozzárendelt nem.
    const messageId = events[1]!.data.messageId;
    const opened = await as(terepes)('GET', `/api/gmail/messages/${messageId}`);
    expect(opened.statusCode).toBe(200);
    expect((opened.json() as MessageDetail).bodyText).toContain('Minta Béla');
    const audit = await one<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'gmail.message' AND entity_id = ${messageId} AND action = 'view'`,
    );
    expect(audit.n).toBe(1);
    expect((await as(admin)('DELETE', `/api/projects/${pid}/members/${terepesId}`)).statusCode).toBe(204);
    expect((await as(terepes)('GET', `/api/gmail/messages/${messageId}`)).statusCode).toBe(403);
    expect((await as(terepes)('GET', `/api/gmail/threads/${threadId}`)).statusCode).toBe(403);
    expect((await as(iroda)('GET', `/api/gmail/threads/${threadId}`)).statusCode).toBe(200);
  });

  it('nem létező szál 404, törölt projekthez nem rendelhető', async () => {
    const pid = await project('Gmail: törölt');
    expect((await as(admin)('DELETE', `/api/projects/${pid}`)).statusCode).toBe(204);
    const threadId = await fixtureThread('Havi hírlevél – akciók');
    expect((await as(iroda)('PUT', `/api/gmail/threads/${threadId}/project`, { projectId: pid })).statusCode).toBe(404);
    expect((await as(iroda)('PUT', `/api/gmail/threads/${crypto.randomUUID()}/project`, { projectId: await project('Gmail: x') })).statusCode).toBe(404);
  });
});

describe('gmail: szabályok', () => {
  it('felvétel, átrendezés, módosítás, törlés; érvénytelen minta 400; terepes 403', async () => {
    const p1 = await project('Gmail: szabály 1');
    const p2 = await project('Gmail: szabály 2');
    expect((await as(iroda)('POST', '/api/gmail/rules', { pattern: '(', projectId: p1 })).statusCode).toBe(400);
    expect((await as(terepes)('GET', '/api/gmail/rules')).statusCode).toBe(403);

    const a = (await as(iroda)('POST', '/api/gmail/rules', { pattern: 'PRJ-001', projectId: p1 })).json() as Rule;
    const b = (await as(iroda)('POST', '/api/gmail/rules', { pattern: 'szabály-kettő', projectId: p2 })).json() as Rule;
    expect(b.position).toBeGreaterThan(a.position);

    const moved = await as(iroda)('PATCH', `/api/gmail/rules/${b.id}`, { position: 0 });
    expect(moved.statusCode).toBe(200);
    const order = ((await as(iroda)('GET', '/api/gmail/rules')).json() as RuleList).items.map((r) => r.id);
    expect(order[0]).toBe(b.id);
    expect(order.indexOf(a.id)).toBeGreaterThan(0);

    const edited = await as(iroda)('PATCH', `/api/gmail/rules/${a.id}`, { pattern: 'prj-00[12]', projectId: p2 });
    expect(edited.json()).toMatchObject({ pattern: 'prj-00[12]', projectId: p2, projectName: 'Gmail: szabály 2' });
    expect((await as(iroda)('DELETE', `/api/gmail/rules/${a.id}`)).statusCode).toBe(204);
    expect((await as(iroda)('DELETE', `/api/gmail/rules/${a.id}`)).statusCode).toBe(404);
    expect((await as(iroda)('DELETE', `/api/gmail/rules/${b.id}`)).statusCode).toBe(204);
  });
});

describe('gmail: fiókok és kézi betöltés', () => {
  it('az admin mock-fiókot köt be (azonnal betölt), az iroda nem; a kézi betöltés nem duplikál', async () => {
    expect((await as(iroda)('GET', '/api/gmail/accounts')).statusCode).toBe(403);
    expect((await as(iroda)('POST', '/api/gmail/accounts', { email: 'masodik@derp.test' })).statusCode).toBe(403);

    const created = await as(admin)('POST', '/api/gmail/accounts', { email: 'Masodik@derp.test' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: 'Masodik@derp.test', source: 'mock', messageCount: 7, lastSyncError: null });
    expect((await as(admin)('POST', '/api/gmail/accounts', { email: 'masodik@derp.test' })).statusCode).toBe(409);

    const list = (await as(admin)('GET', '/api/gmail/accounts')).json() as AccountList;
    expect(list.source).toBe('mock');
    expect(list.items.map((a) => a.email)).toContain(E2E_ACCOUNT);

    // A fixture-postafiókot látó fiókok (a fenti betöltési tesztek fiókjai saját mock-forrást használtak).
    const count = async () =>
      (
        await one<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM gmail_messages m JOIN gmail_accounts a ON a.id = m.account_id
              WHERE lower(a.email) IN (${E2E_ACCOUNT}, 'masodik@derp.test')`,
        )
      ).n;
    const before = await count();
    const sync = await as(iroda)('POST', '/api/gmail/sync');
    expect(sync.statusCode).toBe(200);
    expect(sync.json().items.every((r: { error: string | null }) => r.error === null)).toBe(true);
    expect(await count()).toBe(before);
    expect((await as(terepes)('POST', '/api/gmail/sync')).statusCode).toBe(403);
  });

  it('teszt-végpont: a kézbesített levél a betöltés után hozzárendeletlen szálként megjelenik', async () => {
    const res = await as(iroda)('POST', '/api/gmail/test/deliver', {
      from: 'Teszt <teszt@kulso.test>',
      subject: 'Kézbesítési próba',
      body: 'Kérnék ajánlatot.',
      attachments: [{ name: 'a.pdf', mimeType: 'application/pdf', size: 10 }],
    });
    expect(res.statusCode).toBe(200);
    const { threadIds } = res.json() as { threadIds: string[] };
    expect(threadIds.length).toBeGreaterThan(0);
    const thread = (await as(iroda)('GET', `/api/gmail/threads/${threadIds[0]}`)).json() as ThreadDetail;
    expect(thread).toMatchObject({ subject: 'Kézbesítési próba', projectId: null, status: 'client_rfq_reply_needed', attachmentCount: 1 });
  });
});
