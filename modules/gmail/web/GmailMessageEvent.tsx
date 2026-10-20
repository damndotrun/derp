import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import { fill } from '@/core/i18n.ts';
import type { EventRendererProps } from '@/core/module-types.ts';
import { MAIL_KINDS, type AttachmentMeta, type GmailMessageEventData } from '../shared.ts';
import { gmailApi, messageKey } from './api.ts';
import { t } from './i18n.ts';
import { displayName, formatSize, Tag } from './parts.tsx';

const eventData = (data: Record<string, unknown>): GmailMessageEventData | null =>
  typeof data.messageId === 'string' && typeof data.from === 'string' && MAIL_KINDS.includes(data.kind as GmailMessageEventData['kind'])
    ? (data as unknown as GmailMessageEventData)
    : null;

export function AttachmentList({ items }: { items: AttachmentMeta[] }) {
  return (
    <ul aria-label={t('gmail.message.attachments')} className="flex flex-col gap-0.5 text-sm">
      {items.map((a, i) => (
        <li key={`${a.name}-${i}`} title={t('gmail.message.downloadLater')}>
          📎 {a.name} <span className="text-xs text-muted-foreground">({formatSize(a.size)})</span>
        </li>
      ))}
    </ul>
  );
}

/** A levél törzse kérésre töltődik (a megnyitás az auditnaplóba kerül). */
function MessageBody({ messageId }: { messageId: string }) {
  const message = useQuery({ queryKey: messageKey(messageId), queryFn: () => gmailApi.message(messageId) });
  if (message.isPending) return <p className="text-sm text-muted-foreground">…</p>;
  if (message.isError) return <p className="text-sm text-destructive">{message.error.message}</p>;
  const m = message.data;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
        <dt className="text-muted-foreground">{t('gmail.message.from')}</dt>
        <dd className="break-words">{m.from}</dd>
        <dt className="text-muted-foreground">{t('gmail.message.to')}</dt>
        <dd className="break-words">{m.to.join(', ')}</dd>
        {m.cc.length > 0 && (
          <>
            <dt className="text-muted-foreground">{t('gmail.message.cc')}</dt>
            <dd className="break-words">{m.cc.join(', ')}</dd>
          </>
        )}
      </dl>
      <div aria-label={t('gmail.message.body')} className="whitespace-pre-wrap break-words text-sm">
        {m.bodyText || t('gmail.message.empty')}
      </div>
      {m.attachments.length > 0 && <AttachmentList items={m.attachments} />}
    </div>
  );
}

/** Levél az idővonalon: irány, partner, típus, kivonat; kibontva a törzs és a csatolmánylista. */
export function GmailMessageEvent(props: EventRendererProps) {
  const [open, setOpen] = useState(false);
  const m = eventData(props.event.data);
  if (!m) return <DefaultEvent {...props} />;
  const partner = m.direction === 'in' ? `${t('gmail.message.from')}: ${displayName(m.from)}` : `${t('gmail.message.to')}: ${m.to.map(displayName).join(', ')}`;
  return (
    <DefaultEvent {...props}>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
        <Tag>{t(m.direction === 'in' ? 'gmail.message.in' : 'gmail.message.out')}</Tag>
        {m.kind !== 'msg' && <Tag>{t(`gmail.kind.${m.kind}`)}</Tag>}
        <span className="break-words">{partner}</span>
        {m.attachments.length > 0 && <span className="text-muted-foreground">· {fill(t('gmail.message.attachmentCount'), { n: m.attachments.length })}</span>}
      </p>
      {!open && m.snippet && <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{m.snippet}</p>}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-1 text-sm text-primary hover:underline">
        {open ? `▾ ${t('gmail.message.close')}` : `▸ ${t('gmail.message.open')}`}
      </button>
      {open && <MessageBody messageId={m.messageId} />}
    </DefaultEvent>
  );
}
