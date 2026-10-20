import { sql } from 'drizzle-orm';
import type { Db, DbWriter, ModuleSeedContext } from '@derp/server/module-api';
import { GMAIL_EVENTS, type AttachmentMeta, type GmailMessageEventData, type SyncResult } from '../shared.ts';
import { direction, eventType, type Direction, type MailKind } from './classify.ts';
import { HistoryExpiredError, type MailMessage, type MailSource } from './source.ts';

/** A 90 napos visszamenőleges betöltés. */
export const BACKFILL_DAYS = 90;
/** Elévült `historyId` után az utolsó ismert levél előtti ennyi időtől tölt újra (az átfedést az egyedi kulcs szűri). */
export const RELOAD_OVERLAP_MS = 60 * 60_000;

/** Ezeknél a szolgáltatóknál a domain nem a cégé: az irányt a SENT címke dönti el. */
const PUBLIC_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export interface SyncDeps {
  db: Db;
  appendEvent: ModuleSeedContext['appendEvent'];
  source: MailSource;
  now?: () => Date;
}

export interface AccountRef {
  id: string;
  email: string;
  historyId: string | null;
}

type Row = Record<string, unknown>;
const rows = async <T>(db: Pick<Db, 'execute'>, q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)).rows as T[];

/** A saját domainek: a bekötött fiókok domainjei (a közös szolgáltatók nélkül). */
export async function ownDomains(db: Db): Promise<string[]> {
  const r = await rows<{ domain: string }>(db, sql`SELECT DISTINCT lower(split_part(email, '@', 2)) AS domain FROM gmail_accounts`);
  return r.map((x) => x.domain).filter((d) => d && !PUBLIC_MAIL_DOMAINS.has(d));
}

const titleOf = (subject: string) => `Levél: ${subject.trim() || '(nincs tárgy)'}`;
const attachmentMeta = (m: { attachments: Array<{ name: string; mimeType: string; size: number }> }): AttachmentMeta[] =>
  m.attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size }));

interface StoredMessage {
  id: string;
  thread_id: string;
  /** A `db.execute` szövegként adja vissza az időpontot. */
  sent_at: string | Date;
  from_addr: string;
  to_addrs: string[];
  cc_addrs: string[];
  subject: string;
  snippet: string;
  attachments: AttachmentMeta[];
  direction: Direction;
  kind: MailKind;
}

/**
 * A szál még esemény nélküli leveleinek eseménye a projekt idővonalára (időrendben). A hívó tranzakcióban, a szál
 * sorát zárolva hívja, így a hozzárendelés és a párhuzamos betöltés sem ír kétszer.
 */
export async function emitThreadEvents(
  tx: DbWriter & Pick<Db, 'execute'>,
  appendEvent: ModuleSeedContext['appendEvent'],
  threadId: string,
  projectId: string,
): Promise<number> {
  const pending = await rows<StoredMessage>(
    tx,
    sql`SELECT id, thread_id, sent_at, from_addr, to_addrs, cc_addrs, subject, snippet, attachments, direction, kind
        FROM gmail_messages WHERE thread_id = ${threadId} AND event_id IS NULL ORDER BY sent_at, id`,
  );
  for (const m of pending) {
    const data: GmailMessageEventData = {
      messageId: m.id,
      threadId: m.thread_id,
      from: m.from_addr,
      to: m.to_addrs,
      cc: m.cc_addrs,
      direction: m.direction,
      kind: m.kind,
      snippet: m.snippet,
      attachments: m.attachments,
    };
    const eventId = await appendEvent(
      {
        projectId,
        type: GMAIL_EVENTS.message,
        source: 'gmail',
        title: titleOf(m.subject),
        occurredAt: new Date(m.sent_at),
        data: { ...data },
      },
      tx,
    );
    await tx.execute(sql`UPDATE gmail_messages SET event_id = ${eventId} WHERE id = ${m.id}`);
  }
  return pending.length;
}

/**
 * Egy levél tárolása: a szál létrehozása vagy frissítése, a levél osztályozása, és ha a szál már projekthez tartozik,
 * az esemény. A Gmail üzenet-azonosítója fiókon belül egyedi, így az ismételt betöltés nem duplikál.
 */
export async function storeMessage(deps: SyncDeps, accountId: string, msg: MailMessage, domains: string[]): Promise<boolean> {
  const dir = direction(msg, domains);
  const kind = eventType(`${msg.subject} ${msg.bodyText || msg.snippet}`, dir);
  const sentAt = new Date(msg.date);
  if (Number.isNaN(sentAt.getTime())) throw new Error(`Érvénytelen dátum a(z) ${msg.id} levélben: ${msg.date}`);
  let inserted = false;
  await deps.db.transaction(async (tx) => {
    // Az upsert zárolja a szál sorát (a hozzárendelés is zárolja): a kettő sorban fut.
    const [thread] = await rows<{ id: string; project_id: string | null }>(
      tx,
      sql`INSERT INTO gmail_threads (account_id, gmail_thread_id, subject, first_message_at, last_message_at)
          VALUES (${accountId}, ${msg.threadId}, ${msg.subject}, ${sentAt}, ${sentAt})
          ON CONFLICT (account_id, gmail_thread_id) DO UPDATE SET
            subject = CASE WHEN EXCLUDED.first_message_at < gmail_threads.first_message_at THEN EXCLUDED.subject ELSE gmail_threads.subject END,
            first_message_at = LEAST(gmail_threads.first_message_at, EXCLUDED.first_message_at),
            last_message_at = GREATEST(gmail_threads.last_message_at, EXCLUDED.last_message_at)
          RETURNING id, project_id`,
    );
    const added = await rows<Row>(
      tx,
      sql`INSERT INTO gmail_messages (account_id, gmail_message_id, thread_id, rfc822_message_id, sent_at, from_addr, to_addrs,
            cc_addrs, subject, snippet, label_ids, body_text, body_html, attachments, direction, kind)
          VALUES (${accountId}, ${msg.id}, ${thread!.id}, ${msg.rfc822MessageId}, ${sentAt}, ${msg.from},
            ${sql.param(msg.to)}::text[], ${sql.param(msg.cc)}::text[], ${msg.subject}, ${msg.snippet}, ${sql.param(msg.labelIds)}::text[],
            ${msg.bodyText}, ${msg.bodyHtml}, ${JSON.stringify(attachmentMeta(msg))}::jsonb, ${dir}, ${kind})
          ON CONFLICT (account_id, gmail_message_id) DO NOTHING
          RETURNING id`,
    );
    inserted = added.length > 0;
    if (inserted && thread!.project_id) await emitThreadEvents(tx, deps.appendEvent, thread!.id, thread!.project_id);
  });
  return inserted;
}

/**
 * Egy fiók betöltése. Első alkalommal 90 napra visszamenőleg; utána a `historyId` óta érkezett levelek. Ha a
 * `historyId` elévült, teljes újrabetöltés az utolsó ismert levél dátumától (a meglévő levelek kimaradnak). A
 * `historyId`-t a listázás előtt kéri, így a közben érkező levél a következő körben jön meg.
 */
export async function syncAccount(deps: SyncDeps, account: AccountRef): Promise<SyncResult> {
  const { db, source } = deps;
  const now = deps.now?.() ?? new Date();
  let mode: SyncResult['mode'];
  let ids: string[];
  let historyId: string;

  const fullLoad = async (after: Date) => {
    historyId = await source.currentHistoryId(account.email);
    ids = await source.listMessageIds(account.email, after);
  };

  if (!account.historyId) {
    mode = 'backfill';
    await fullLoad(new Date(now.getTime() - BACKFILL_DAYS * 86_400_000));
  } else {
    try {
      const h = await source.listHistory(account.email, account.historyId);
      mode = 'history';
      ids = h.messageIds;
      historyId = h.historyId;
    } catch (err) {
      if (!(err instanceof HistoryExpiredError)) throw err;
      mode = 'reload';
      const [last] = await rows<{ last: string | Date | null }>(db, sql`SELECT max(sent_at) AS last FROM gmail_messages WHERE account_id = ${account.id}`);
      const from = last?.last ? new Date(new Date(last.last).getTime() - RELOAD_OVERLAP_MS) : new Date(now.getTime() - BACKFILL_DAYS * 86_400_000);
      await fullLoad(from);
    }
  }

  const unique = [...new Set(ids!)];
  const known = new Set(
    unique.length === 0
      ? []
      : (
          await rows<{ id: string }>(
            db,
            sql`SELECT gmail_message_id AS id FROM gmail_messages WHERE account_id = ${account.id} AND gmail_message_id = ANY(${sql.param(unique)}::text[])`,
          )
        ).map((r) => r.id),
  );
  const domains = await ownDomains(db);
  let fetched = 0;
  let inserted = 0;
  for (const id of unique) {
    if (known.has(id)) continue;
    const msg = await source.getMessage(account.email, id);
    if (!msg) continue;
    fetched += 1;
    if (await storeMessage(deps, account.id, msg, domains)) inserted += 1;
  }
  await db.execute(
    sql`UPDATE gmail_accounts SET history_id = ${historyId!}, last_sync_at = now(), last_sync_error = NULL WHERE id = ${account.id}`,
  );
  return { account: account.email, mode: mode!, fetched, inserted, error: null };
}

/** Minden bekötött fiók betöltése; egy fiók hibája nem állítja meg a többit (a hiba a fióknál látszik). */
export async function syncAll(deps: SyncDeps, onError?: (account: string, err: unknown) => void): Promise<SyncResult[]> {
  const accounts = await rows<AccountRef>(
    deps.db,
    sql`SELECT id, email, history_id AS "historyId" FROM gmail_accounts WHERE source = ${deps.source.kind} ORDER BY created_at, id`,
  );
  const results: SyncResult[] = [];
  for (const a of accounts) {
    try {
      results.push(await syncAccount(deps, a));
    } catch (err) {
      onError?.(a.email, err);
      const message = err instanceof Error ? err.message : String(err);
      await deps.db.execute(sql`UPDATE gmail_accounts SET last_sync_error = ${message}, last_sync_at = now() WHERE id = ${a.id}`);
      results.push({ account: a.email, mode: a.historyId ? 'history' : 'backfill', fetched: 0, inserted: 0, error: message });
    }
  }
  return results;
}
