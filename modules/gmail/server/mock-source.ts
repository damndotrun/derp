import { readFileSync } from 'node:fs';
import { HistoryExpiredError, type MailAttachment, type MailMessage, type MailSource } from './source.ts';

/** Egy fixture-levél: az időpont a forrás létrehozásához képest (`minutesAgo`), hogy a 90 napos ablakba essen. */
export interface FixtureMessage {
  id: string;
  threadId: string;
  minutesAgo: number;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  labelIds?: string[];
  attachments?: MailAttachment[];
}

const DEFAULT_FIXTURE = new URL('./fixtures/mock-mailbox.json', import.meta.url);

export function loadFixture(url: URL = DEFAULT_FIXTURE): FixtureMessage[] {
  return (JSON.parse(readFileSync(url, 'utf8')) as { messages: FixtureMessage[] }).messages;
}

interface Stored {
  message: MailMessage;
  /** A postafiók-történet sorszáma, amikor a levél megérkezett. */
  historyId: number;
}

const snippetOf = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * Mock-forrás: minden bekötött fiók ugyanazt a fixture-postafiókot látja. A teszt új levelet „kézbesíthet”
 * (`deliver`), és elévültetheti a korábbi `historyId`-kat (`expireHistory`), mint a Gmail kb. egy hét után.
 */
export class MockMailSource implements MailSource {
  readonly kind = 'mock' as const;
  private readonly messages = new Map<string, Stored>();
  /**
   * A `historyId` időalapú és csak nő (mint a Gmailé), így a szerver újraindítása után a korábban eltárolt érték
   * kisebb marad az új postafiók-történetnél, és az azóta érkezett levél nem marad ki.
   */
  private history = 0;
  /** Ennél kisebb `historyId`-ról a `listHistory` elévülést jelez. */
  private oldestHistoryId = 0;

  private readonly clock: () => number;

  /** A `clock` a `historyId` alsó határa (tesztben `() => 0`, így a `historyId` 1, 2, 3, …). */
  constructor(fixture: FixtureMessage[] = loadFixture(), now: Date = new Date(), clock: () => number = Date.now) {
    this.clock = clock;
    for (const f of fixture) this.deliver(f, now);
  }

  /** Új levél a postafiókba (a fixture formájában); a `historyId` eggyel nő. */
  deliver(f: FixtureMessage, now: Date = new Date()): MailMessage {
    const message: MailMessage = {
      id: f.id,
      threadId: f.threadId,
      rfc822MessageId: `<${f.id}@mock.derp.test>`,
      date: new Date(now.getTime() - f.minutesAgo * 60_000).toISOString(),
      from: f.from,
      to: f.to,
      cc: f.cc ?? [],
      subject: f.subject,
      snippet: snippetOf(f.body),
      labelIds: f.labelIds ?? ['INBOX'],
      bodyText: f.body,
      bodyHtml: null,
      attachments: f.attachments ?? [],
    };
    this.history = Math.max(this.history + 1, this.clock());
    this.messages.set(f.id, { message, historyId: this.history });
    return message;
  }

  /** Minden eddigi `historyId` elévül (a következő `listHistory` a régiekkel `HistoryExpiredError`-t dob). */
  expireHistory(): void {
    this.oldestHistoryId = this.history;
  }

  async currentHistoryId(): Promise<string> {
    return String(this.history);
  }

  async listMessageIds(_account: string, after: Date): Promise<string[]> {
    return [...this.messages.values()].filter((s) => new Date(s.message.date) > after).map((s) => s.message.id);
  }

  async getMessage(_account: string, id: string): Promise<MailMessage | null> {
    return this.messages.get(id)?.message ?? null;
  }

  async listHistory(account: string, startHistoryId: string): Promise<{ messageIds: string[]; historyId: string }> {
    const start = Number(startHistoryId);
    if (!Number.isInteger(start) || start < this.oldestHistoryId) throw new HistoryExpiredError(account, startHistoryId);
    const messageIds = [...this.messages.values()].filter((s) => s.historyId > start).map((s) => s.message.id);
    return { messageIds, historyId: String(this.history) };
  }
}
