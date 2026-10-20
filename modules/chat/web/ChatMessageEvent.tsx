import { Link } from 'react-router';
import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';
import type { ChatMessageEventData } from '../shared.ts';
import { t } from './i18n.ts';

const messageData = (data: Record<string, unknown>): ChatMessageEventData | null =>
  typeof data.messageId === 'string' && typeof data.body === 'string' ? (data as unknown as ChatMessageEventData) : null;

/** „Chat-üzenet” az idővonalon: a szöveg (hosszú üzenetnél levágva) és link a chatre; a csatolmányok alatta, a `docs` eseményeiként. */
export function ChatMessageEvent(props: EventRendererProps) {
  const m = messageData(props.event.data);
  const projectId = props.event.projectId;
  if (!m) return <DefaultEvent {...props} />;
  return (
    <DefaultEvent {...props}>
      {m.body && <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm">{m.body}</p>}
      <p className="mt-1 text-sm">
        {m.attachments > 0 && (
          <span className="text-muted-foreground">
            {m.attachments} {t('chat.attachmentCount')} ·{' '}
          </span>
        )}
        {projectId && (
          <Link to={`/chat/${projectId}`} className="underline">
            {t('chat.openInChat')}
          </Link>
        )}
      </p>
    </DefaultEvent>
  );
}
