import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/core/api.ts';
import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import { fill } from '@/core/i18n.ts';
import type { EventRendererProps } from '@/core/module-types.ts';
import { MAIL_KINDS, type AttachmentMeta, type GmailMessageEventData, type GmailThreadMovedEventData, type MessageDetail } from '../shared.ts';
import { gmailApi, gmailKey, messageKey, useGmailPermission } from './api.ts';
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

/** Az iroda áthelyezheti a levél szálát másik projektbe (a régi idővonalon „áthelyezve” esemény marad). */
function MoveThread({ message }: { message: MessageDetail }) {
  const queryClient = useQueryClient();
  const selectId = useId();
  const [projectId, setProjectId] = useState('');
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const move = useMutation({
    mutationFn: () => gmailApi.assign(message.threadId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gmailKey });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const target = projects.data?.items.find((p) => p.id === projectId);
  if (move.isSuccess && target) return <p role="status" className="text-sm">{fill(t('gmail.message.moved'), { project: target.name })}</p>;
  return (
    <form
      aria-label={t('gmail.message.move')}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (projectId) move.mutate();
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-sm">
        <Label htmlFor={selectId}>{t('gmail.message.moveTo')}</Label>
        <Select id={selectId} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{t('gmail.inbox.chooseProject')}</option>
          {(projects.data?.items ?? [])
            .filter((p) => p.id !== message.projectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!projectId || move.isPending}>
        {t('gmail.message.moveButton')}
      </Button>
      {move.isError && <p className="w-full text-sm text-destructive">{move.error.message}</p>}
    </form>
  );
}

/** A levél törzse kérésre töltődik (a megnyitás az auditnaplóba kerül). */
function MessageBody({ messageId, eventProjectId }: { messageId: string; eventProjectId: string | null }) {
  const canAssign = useGmailPermission('gmail.assign');
  const message = useQuery({ queryKey: messageKey(messageId), queryFn: () => gmailApi.message(messageId) });
  if (message.isPending) return <p className="text-sm text-muted-foreground">…</p>;
  if (message.isError) {
    const forbidden = message.error instanceof ApiError && message.error.status === 403;
    return <p className="text-sm text-destructive">{forbidden ? t('gmail.message.unavailable') : message.error.message}</p>;
  }
  const m = message.data;
  const movedAway = m.projectId !== eventProjectId;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      {movedAway && <p className="text-sm font-medium">{t('gmail.message.movedAway')}</p>}
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
      {canAssign && !movedAway && <MoveThread message={m} />}
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
      {open && <MessageBody messageId={m.messageId} eventProjectId={props.event.projectId} />}
    </DefaultEvent>
  );
}

/** „Levélszál áthelyezve” a régi projekt idővonalán; az iroda linket kap az új projektre. */
export function GmailThreadMovedEvent(props: EventRendererProps) {
  const canAssign = useGmailPermission('gmail.assign');
  const d = props.event.data as Partial<GmailThreadMovedEventData>;
  if (typeof d.toProjectId !== 'string' || typeof d.messages !== 'number') return <DefaultEvent {...props} />;
  return (
    <DefaultEvent {...props}>
      <p className="mt-1 text-sm text-muted-foreground">
        {fill(t('gmail.moved.messages'), { n: d.messages })}{' '}
        {canAssign && (
          <Link to={`/projects/${d.toProjectId}`} className="underline">
            {t('gmail.moved.open')}
          </Link>
        )}
      </p>
    </DefaultEvent>
  );
}
