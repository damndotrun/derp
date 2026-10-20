// A Gmail modul szerver és kliens közötti adatformái (a szerver ezekkel validál, a kliens a típusokat használja).
import { z } from 'zod';

export const MAIL_KINDS = ['order', 'quote_in', 'rfq_out', 'client_rfq', 'msg'] as const;
export const THREAD_STATUSES = [
  'order',
  'client_rfq_reply_needed',
  'quote_processing',
  'quote_received',
  'client_rfq_open',
  'rfq_sent',
  'discussion',
] as const;

export const MailKind = z.enum(MAIL_KINDS);
export const Direction = z.enum(['in', 'out']);

export const AttachmentMeta = z.object({ name: z.string(), mimeType: z.string(), size: z.number().int() });
export type AttachmentMeta = z.infer<typeof AttachmentMeta>;

export const GMAIL_EVENTS = { message: 'gmail.message', threadMoved: 'gmail.thread_moved' } as const;

/** A `gmail.thread_moved` esemény `data` mezője (a régi projekt idővonalán). */
export interface GmailThreadMovedEventData {
  threadId: string;
  subject: string;
  toProjectId: string;
  messages: number;
}

/** A `gmail.message` esemény `data` mezője (a törzs nincs benne: kérésre töltődik, auditnaplóval). */
export interface GmailMessageEventData {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  direction: 'in' | 'out';
  kind: (typeof MAIL_KINDS)[number];
  snippet: string;
  attachments: AttachmentMeta[];
}

const iso = z.iso.datetime({ offset: true });

export const MessageDetail = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  projectId: z.uuid().nullable(),
  subject: z.string(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  sentAt: iso,
  direction: Direction,
  kind: MailKind,
  snippet: z.string(),
  bodyText: z.string(),
  attachments: z.array(AttachmentMeta),
});
export type MessageDetail = z.infer<typeof MessageDetail>;

export const Suggestion = z.object({ ruleId: z.uuid(), projectId: z.uuid(), projectName: z.string() });
export type Suggestion = z.infer<typeof Suggestion>;

export const ThreadSummary = z.object({
  id: z.uuid(),
  account: z.string(),
  subject: z.string(),
  firstMessageAt: iso,
  lastMessageAt: iso,
  messageCount: z.number().int(),
  /** A levelek feladói, első előfordulásuk sorrendjében. */
  participants: z.array(z.string()),
  lastSnippet: z.string(),
  attachmentCount: z.number().int(),
  status: z.enum(THREAD_STATUSES),
  /** A szövegben határidőre utaló kifejezés van. */
  deadline: z.boolean(),
  projectId: z.uuid().nullable(),
  /** Az első illeszkedő szabály projektje (csak hozzárendeletlen szálnál). */
  suggestion: Suggestion.nullable(),
  /** Elvetve (pl. hírlevél): nincs a „Hozzárendeletlen levelek” között, visszaállítható. */
  dismissedAt: iso.nullable(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

export const ThreadList = z.object({ items: z.array(ThreadSummary), total: z.number().int() });
export type ThreadList = z.infer<typeof ThreadList>;

export const ThreadsQuery = z.object({
  /** `open`: a hozzárendeletlen, el nem vetett szálak; `dismissed`: az elvetettek. */
  view: z.enum(['open', 'dismissed']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ThreadDetail = ThreadSummary.extend({ messages: z.array(MessageDetail) });
export type ThreadDetail = z.infer<typeof ThreadDetail>;

/** `PUT /api/gmail/threads/:threadId/project` törzse (hozzárendelés vagy áthelyezés másik projektbe). */
export const ThreadAssign = z.object({ projectId: z.uuid() });

/** `PUT /api/gmail/threads/:threadId/dismissed` törzse. */
export const ThreadDismiss = z.object({ dismissed: z.boolean() });

export const MAX_PATTERN = 200;

/** Kis- és nagybetűtől független reguláris kifejezés (projektkód vagy kulcsszó is lehet). */
export const RulePattern = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PATTERN)
  .refine((p) => {
    try {
      new RegExp(p, 'i');
      return true;
    } catch {
      return false;
    }
  }, 'Érvénytelen reguláris kifejezés');

export const Rule = z.object({ id: z.uuid(), pattern: z.string(), projectId: z.uuid(), projectName: z.string(), position: z.number().int() });
export type Rule = z.infer<typeof Rule>;
export const RuleList = z.object({ items: z.array(Rule) });
export type RuleList = z.infer<typeof RuleList>;
export const RuleCreate = z.object({ pattern: RulePattern, projectId: z.uuid() });
export type RuleCreate = z.input<typeof RuleCreate>;
export const RuleUpdate = z
  .object({ pattern: RulePattern.optional(), projectId: z.uuid().optional(), position: z.number().int().min(0).optional() })
  .refine((u) => u.pattern !== undefined || u.projectId !== undefined || u.position !== undefined, 'Nincs mit módosítani');
export type RuleUpdate = z.input<typeof RuleUpdate>;

export const Account = z.object({
  id: z.uuid(),
  email: z.string(),
  source: z.enum(['mock', 'gmail']),
  lastSyncAt: iso.nullable(),
  lastSyncError: z.string().nullable(),
  messageCount: z.number().int(),
});
export type Account = z.infer<typeof Account>;
export const AccountList = z.object({ source: z.enum(['mock', 'gmail']), items: z.array(Account) });
export type AccountList = z.infer<typeof AccountList>;
export const AccountCreate = z.object({ email: z.string().trim().max(254).pipe(z.email()) });

export const SyncResult = z.object({
  account: z.string(),
  /** `backfill`: első, 90 napos betöltés; `history`: növekményes; `reload`: elévült historyId után újrabetöltés. */
  mode: z.enum(['backfill', 'history', 'reload']),
  fetched: z.number().int(),
  inserted: z.number().int(),
  error: z.string().nullable(),
});
export type SyncResult = z.infer<typeof SyncResult>;
export const SyncResults = z.object({ items: z.array(SyncResult) });
export type SyncResults = z.infer<typeof SyncResults>;
