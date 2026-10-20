// A projekt-chat szerver és kliens közötti adatformái (a szerver ezekkel validál, a kliens a típusokat használja).
import { z } from 'zod';

export const MAX_BODY = 4000;
export const MAX_ATTACHMENTS = 20;

/** Csatolmány az üzenet létrehozásakor: a kliens által kiosztott `docs_files.id` és a fájl neve. */
export const AttachmentRef = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(255) });
export type AttachmentRef = z.infer<typeof AttachmentRef>;

/** `PUT /api/chat/projects/:projectId/messages/:messageId` törzse. */
export const MessageCreate = z
  .object({
    body: z.string().trim().max(MAX_BODY).default(''),
    attachments: z.array(AttachmentRef).max(MAX_ATTACHMENTS).default([]),
    /**
     * Kliens oldali időbélyeg (pl. offline írt üzenet): ez lesz az üzenet és az esemény ideje (a jövőbeli helyett a
     * szerver ideje, a 30 napnál régebbit a szerver nem veszi figyelembe). A sorrend (`seq`) a szerverre érkezésé
     * marad; az újraküldés összevetésében nem számít.
     */
    capturedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((m) => m.body.length > 0 || m.attachments.length > 0, 'Üres üzenet nem küldhető')
  .refine((m) => new Set(m.attachments.map((a) => a.id)).size === m.attachments.length, 'Egy fájl kétszer szerepel');
export type MessageCreate = z.input<typeof MessageCreate>;

export const Person = z.object({ id: z.uuid(), name: z.string() });
export type Person = z.infer<typeof Person>;

/**
 * Csatolmány az üzenetben: `ready`, ha a fájl a dokumentumtárban van; `pending`, ha még nem töltődött fel (pl. az
 * offline sorban vár); `deleted`, ha azóta törölték a dokumentumtárból.
 */
export const ChatAttachment = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['ready', 'pending', 'deleted']),
  mime: z.string().nullable(),
  size: z.number().int().nullable(),
  hasThumb: z.boolean(),
  folderId: z.uuid().nullable(),
});
export type ChatAttachment = z.infer<typeof ChatAttachment>;

export const ChatMessage = z.object({
  id: z.uuid(),
  /** A szerverre érkezés sorszáma: a szálon belüli sorrend és az olvasottság mértéke. */
  seq: z.number().int(),
  projectId: z.uuid(),
  author: Person,
  body: z.string(),
  /** Az üzenetben @-tal megemlített felhasználók (akik a projektet látják). */
  mentions: z.array(Person),
  attachments: z.array(ChatAttachment),
  eventId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const MessagesQuery = z.object({
  /** Lapozás: az ennél kisebb `seq`-ű üzenetek. */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Egy projekt üzeneteinek egy lapja, `seq` szerint növekvő sorrendben. */
export const MessagePage = z.object({
  items: z.array(ChatMessage),
  /** A következő (régebbi) lap `before` értéke; `null`, ha nincs több. */
  nextBefore: z.number().int().nullable(),
  /** Meddig olvasta a bejelentkezett felhasználó. */
  lastReadSeq: z.number().int(),
  /** A többi felhasználó olvasottsága („Látta: …”). */
  reads: z.array(z.object({ user: Person, lastReadSeq: z.number().int(), readAt: z.iso.datetime({ offset: true }) })),
});
export type MessagePage = z.infer<typeof MessagePage>;

/** `PUT /api/chat/projects/:projectId/read`: olvasott eddig a sorszámig (csak előre léptet). */
export const ReadUpdate = z.object({ seq: z.number().int().min(0) });

/** Olvasatlan üzenetek a látható projektekben (a saját üzenetek nem számítanak). */
export const UnreadSummary = z.object({
  total: z.number().int(),
  /** Ebből annyi, ahol a felhasználót megemlítették. */
  mentions: z.number().int(),
  projects: z.array(
    z.object({
      projectId: z.uuid(),
      unread: z.number().int(),
      mentions: z.number().int(),
      lastMessageAt: z.iso.datetime({ offset: true }),
    }),
  ),
});
export type UnreadSummary = z.infer<typeof UnreadSummary>;

export const PeopleList = z.object({ items: z.array(Person) });
export type PeopleList = z.infer<typeof PeopleList>;

export const CHAT_EVENTS = { messagePosted: 'chat.message_posted' } as const;

/** A `chat.message_posted` esemény `data` mezője. */
export interface ChatMessageEventData {
  messageId: string;
  body: string;
  /** A megemlített felhasználók azonosítói. */
  mentions: string[];
  attachments: number;
}

/** A dokumentumtár mappája, ahová a chat csatolmányai kerülnek (a projekt gyökerében). */
export const CHAT_FOLDER = 'Chat';
