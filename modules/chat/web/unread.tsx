import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveEvents } from '@/core/stream.ts';
import { cn } from '@/lib/utils';
import { CHAT_EVENTS } from '../shared.ts';
import { chatApi, unreadKey } from './api.ts';
import { t } from './i18n.ts';

/** Olvasatlan üzenetek a látható projektekben; új chat-üzenetnél és hozzárendelés-változásnál frissül. */
export function useUnread() {
  const queryClient = useQueryClient();
  useLiveEvents((e) => {
    if (e.type === CHAT_EVENTS.messagePosted || e.type === 'core.member_added' || e.type === 'core.member_removed') {
      void queryClient.invalidateQueries({ queryKey: unreadKey });
    }
  });
  return useQuery({ queryKey: unreadKey, queryFn: chatApi.unread, staleTime: 30_000 });
}

/** Szám-jelvény; `mention` esetén `@` jelzi, hogy a felhasználót is megemlítették. */
export function UnreadCount({ count, mention, className }: { count: number; mention?: boolean; className?: string }) {
  if (count <= 0) return null;
  const label = `${count} ${t('chat.unread')}${mention ? `, ${t('chat.mentioned')}` : ''}`;
  // A szám csak látványelem; a felolvasó (és a link neve) a teljes szöveget kapja.
  return (
    <span
      title={label}
      className={cn('inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground', className)}
    >
      <span aria-hidden>
        {mention && '@'}
        {count}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A „Chat” menüpont jelvénye: az összes olvasatlan üzenet. */
export function ChatMenuBadge() {
  const unread = useUnread();
  return <UnreadCount count={unread.data?.total ?? 0} mention={(unread.data?.mentions ?? 0) > 0} />;
}

/** A projekt-adatlap „Chat” linkjének jelvénye: a projekt olvasatlan üzenetei. */
export function ProjectChatBadge({ projectId }: { projectId: string }) {
  const p = useUnread().data?.projects.find((x) => x.projectId === projectId);
  return <UnreadCount count={p?.unread ?? 0} mention={(p?.mentions ?? 0) > 0} />;
}
