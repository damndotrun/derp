import { sql } from 'drizzle-orm';
import type { Db } from '@derp/server/module-api';
import type { Account } from '../shared.ts';
import type { MailSourceKind } from './mail-source.ts';

const rows = async <T>(db: Pick<Db, 'execute'>, q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)).rows as T[];

interface AccountRow {
  id: string;
  email: string;
  source: MailSourceKind;
  last_sync_at: string | Date | null;
  last_sync_error: string | null;
  message_count: number;
}

const SELECT_ACCOUNTS = sql`
  SELECT a.id, a.email, a.source, a.last_sync_at, a.last_sync_error,
    (SELECT count(*)::int FROM gmail_messages m WHERE m.account_id = a.id) AS message_count
  FROM gmail_accounts a`;

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  email: r.email,
  source: r.source,
  lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
  lastSyncError: r.last_sync_error,
  messageCount: r.message_count,
});

export async function listAccounts(db: Db): Promise<Account[]> {
  return (await rows<AccountRow>(db, sql`${SELECT_ACCOUNTS} ORDER BY a.created_at, a.id`)).map(toAccount);
}

export async function getAccount(db: Db, id: string): Promise<Account | null> {
  const [r] = await rows<AccountRow>(db, sql`${SELECT_ACCOUNTS} WHERE a.id = ${id}`);
  return r ? toAccount(r) : null;
}

/** Fiók felvétele; ha már megvan (kis- és nagybetűtől függetlenül), `null`. */
export async function addAccount(db: Pick<Db, 'execute'>, input: { email: string; source: MailSourceKind; userId: string | null }): Promise<string | null> {
  const [r] = await rows<{ id: string }>(
    db,
    sql`INSERT INTO gmail_accounts (email, source, created_by) VALUES (${input.email}, ${input.source}, ${input.userId})
        ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`,
  );
  return r?.id ?? null;
}
