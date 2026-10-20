// A levelek osztályozása: irány, projektjavaslat szabály szerint, eseménytípus magyar kulcsszavakkal, a szál
// státusza. Portolva a damndotrun/email-project-timeline `src/classify.js`-éből (a tesztjei: test/classify.*.test.ts).

export type Direction = 'in' | 'out';
export type MailKind = 'order' | 'quote_in' | 'rfq_out' | 'client_rfq' | 'msg';

/** Az irányhoz elég a feladó és a Gmail-címkék. */
export interface DirectionInput {
  from?: string | null;
  labelIds?: string[] | null;
}

/** Kimenő, ha a Gmail elküldöttként címkézte, vagy a feladó a saját domainek egyikéről ír. */
export function direction(msg: DirectionInput, ownDomains: string[] = []): Direction {
  const labels = msg.labelIds || [];
  if (labels.includes('SENT')) return 'out';
  const from = String(msg.from || '').toLowerCase();
  if (ownDomains.some((d) => from.includes('@' + d.toLowerCase()))) return 'out';
  return 'in';
}

/** Egy hozzárendelési szabály: kis- és nagybetűtől független reguláris kifejezés. */
export interface ProjectRule {
  id: string;
  name: string;
  pattern: string;
  color?: string;
}

/** Az első illeszkedő szabály nyer (a szabályok sorrendje számít). */
export function detectProject(text: string | null | undefined, rules: ProjectRule[]): { id: string; name: string; color?: string } | null {
  const t = String(text || '').toLowerCase();
  for (const rule of rules) {
    if (new RegExp(rule.pattern, 'i').test(t)) {
      return { id: rule.id, name: rule.name, color: rule.color };
    }
  }
  return null;
}

const ORDER_RE = /(megrendel|rendelés|visszaigazol)/i;
const RFQ_RE = /(ajánlatkér|árajánlatkér|kérnék ajánlat|kérlek frissít|szeretn[ée](?:m|nk) ajánlat)/i;
const QUOTE_RE = /(ajánlat|árajánlat)/i;
// Beérkező ajánlat (pl. „Csatoltan küldjük árajánlatunkat”): erősebb, mint a válasz tárgyában visszhangzó
// „ajánlatkérés” („Re: … ajánlatkérés”).
const QUOTE_DELIVERY_RE = /(csatoltan|mellékelt|küldj[uü]k|megküldj[uü]k|csatolva).{0,40}ajánlat|ajánlat.{0,40}(csatoltan|mellékelt|küldj[uü]k|csatolva)/i;

export function eventType(text: string | null | undefined, dir: Direction): MailKind {
  const t = String(text || '').toLowerCase();
  if (ORDER_RE.test(t)) return 'order';
  if (dir === 'in' && QUOTE_DELIVERY_RE.test(t)) return 'quote_in';
  if (RFQ_RE.test(t)) return dir === 'out' ? 'rfq_out' : 'client_rfq';
  if (QUOTE_RE.test(t) && dir === 'in') return 'quote_in';
  return 'msg';
}

export type ThreadStatusKey =
  | 'order'
  | 'client_rfq_reply_needed'
  | 'quote_processing'
  | 'quote_received'
  | 'client_rfq_open'
  | 'rfq_sent'
  | 'discussion';

export interface ThreadStatus {
  key: ThreadStatusKey;
  label: string;
  color: string;
}

const STATUS: Record<ThreadStatusKey, ThreadStatus> = {
  order: { key: 'order', label: 'Megrendelés / visszaigazolás', color: '#2e9e5b' },
  client_rfq_reply_needed: { key: 'client_rfq_reply_needed', label: 'Ügyfél-ajánlatkérés — válasz kell', color: '#c0306b' },
  quote_processing: { key: 'quote_processing', label: 'Ajánlat feldolgozás alatt', color: '#e08a1e' },
  quote_received: { key: 'quote_received', label: 'Ajánlat beérkezett', color: '#e08a1e' },
  client_rfq_open: { key: 'client_rfq_open', label: 'Ügyfél-ajánlatkérés folyamatban', color: '#c0306b' },
  rfq_sent: { key: 'rfq_sent', label: 'Ajánlatkérés kiment — válaszra várunk', color: '#2f5bd0' },
  discussion: { key: 'discussion', label: 'Egyeztetés', color: '#7a52c7' },
};

/** A szál státusza a levelei alapján; az események időrendben, a legrégebbi elöl. */
export function deriveStatus(events: Array<{ eventType: MailKind; direction: Direction }> | null | undefined): ThreadStatus {
  if (!events || events.length === 0) return STATUS.discussion;
  const sorted = events;
  const last = sorted[sorted.length - 1]!;
  const has = (t: MailKind) => sorted.some((e) => e.eventType === t);

  if (has('order')) return STATUS.order;
  if (last.eventType === 'client_rfq') return STATUS.client_rfq_reply_needed;
  if (has('quote_in')) return last.direction === 'out' ? STATUS.quote_processing : STATUS.quote_received;
  if (has('client_rfq')) return STATUS.client_rfq_open;
  if (has('rfq_out')) return STATUS.rfq_sent;
  return STATUS.discussion;
}

const DEADLINE_RE = /(\d{1,2})[.\-/ ]*(jan|feb|már|ápr|máj|jún|júl|aug|szep|okt|nov|dec)|júni?us 20|határidő|leadás/i;
export function hasDeadline(text: string | null | undefined): boolean {
  return DEADLINE_RE.test(String(text || '').toLowerCase());
}
