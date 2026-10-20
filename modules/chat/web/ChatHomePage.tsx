import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { api } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { t as coreT } from '@/core/i18n.ts';
import { useSession } from '@/core/session.ts';
import { t } from './i18n.ts';
import { UnreadCount, useUnread } from './unread.tsx';

/** A chat kezdőlapja: a látható projektek (a terepesnek csak a hozzá rendeltek), elöl a legutóbb aktívak, olvasatlan-jelvénnyel. */
export function ChatHomePage() {
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const unread = useUnread();
  const activity = new Map(unread.data?.projects.map((p) => [p.projectId, p]));
  const sorted = [...(projects.data?.items ?? [])].sort((a, b) => {
    const x = activity.get(a.id)?.lastMessageAt ?? '';
    const y = activity.get(b.id)?.lastMessageAt ?? '';
    return x === y ? a.name.localeCompare(b.name, 'hu') : y.localeCompare(x);
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('chat.title')}</h1>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('chat.chooseProject')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {projects.isPending && <p className="px-4 pb-4">{coreT('common.loading')}</p>}
          {projects.isError && <p className="px-4 pb-4 text-destructive">{projects.error.message}</p>}
          {projects.data?.items.length === 0 && <p className="px-4 pb-4 text-muted-foreground">{t('chat.noProjects')}</p>}
          <ul aria-label={t('chat.projects')} className="divide-y">
            {sorted.map((p) => {
              const a = activity.get(p.id);
              return (
                <li key={p.id}>
                  <Link to={`/chat/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {a ? formatDateTime(a.lastMessageAt, tz) : t('chat.noMessagesYet')}
                      </span>
                    </span>
                    <UnreadCount count={a?.unread ?? 0} mention={(a?.mentions ?? 0) > 0} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
