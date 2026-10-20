// A levélforrás felülete (a régi `MailSource` mintájára, a Gmail API szerkezetéhez igazítva). A mock-forrás
// (`MAIL_SOURCE=mock`) fixture-ökből dolgozik; az élő `GmailSource` a 14. munkacsomagban jön ugyanerre a felületre.

/** Csatolmány-metaadat; maga a fájl csak kérésre töltődik le (14.). */
export interface MailAttachment {
  name: string;
  mimeType: string;
  size: number;
  /** A Gmail csatolmány-azonosítója (a letöltéshez). */
  attachmentId: string;
}

/** Egy levél a forrás egységes alakjában. Az időpont UTC-ben (ISO 8601). */
export interface MailMessage {
  /** A Gmail üzenet-azonosítója (fiókon belül egyedi): ez zárja ki a duplikációt. */
  id: string;
  threadId: string;
  /** Az RFC 822 `Message-ID` fejléc (fiókok között azonos). */
  rfc822MessageId: string | null;
  date: string;
  /** A `From` fejléc (`Név <cím>` vagy csak cím). */
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  labelIds: string[];
  bodyText: string;
  bodyHtml: string | null;
  attachments: MailAttachment[];
}

/** Elévült `historyId` (a Gmail `history.list` 404-et ad): teljes újrabetöltés kell. */
export class HistoryExpiredError extends Error {
  constructor(account: string, historyId: string) {
    super(`A(z) ${account} fiók historyId-ja (${historyId}) elévült`);
    this.name = 'HistoryExpiredError';
  }
}

export interface MailSource {
  readonly kind: 'mock' | 'gmail';
  /** A postafiók aktuális `historyId`-ja (a betöltés előtt kérve, hogy a közben érkező levél se vesszen el). */
  currentHistoryId(account: string): Promise<string>;
  /** Az adott időpont után érkezett levelek azonosítói (90 napos visszamenőleges betöltés, illetve újrabetöltés). */
  listMessageIds(account: string, after: Date): Promise<string[]>;
  /** Egy levél; `null`, ha azóta törölték. */
  getMessage(account: string, id: string): Promise<MailMessage | null>;
  /** A `historyId` óta hozzáadott levelek; elévült `historyId`-nál `HistoryExpiredError`. */
  listHistory(account: string, startHistoryId: string): Promise<{ messageIds: string[]; historyId: string }>;
}
