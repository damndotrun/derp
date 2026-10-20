import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { Project } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { fill } from '@/core/i18n.ts';
import { RoleGate } from '@/core/RoleGate.tsx';
import { useSession } from '@/core/session.ts';
import type { ThreadSummary } from '../shared.ts';
import { gmailApi, gmailKey, threadsKey, useLiveGmail } from './api.ts';
import { AttachmentList } from './GmailMessageEvent.tsx';
import { t } from './i18n.ts';
import { displayName, GmailNav, StatusBadge, Tag } from './parts.tsx';

const PAGE = 50;

/** „Hozzárendeletlen levelek”: a projekthez még nem rendelt szálak; innen rendelhetők projekthez. */
export function InboxPage() {
  return (
    <RoleGate roles={['admin', 'iroda']}>
      <Inbox />
    </RoleGate>
  );
}

function Inbox() {
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState<{ text: string; projectId?: string } | null>(null);
  useLiveGmail();

  const threads = useQuery({ queryKey: [...threadsKey, limit], queryFn: () => gmailApi.unassigned(limit) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  const sync = useMutation({
    mutationFn: gmailApi.sync,
    onSuccess: (res) => {
      const failed = res.items.find((r) => r.error);
      setNotice({
        text: failed
          ? fill(t('gmail.sync.failed'), { account: failed.account, error: failed.error! })
          : fill(t('gmail.sync.done'), { n: res.items.reduce((n, r) => n + r.inserted, 0) }),
      });
      void queryClient.invalidateQueries({ queryKey: gmailKey });
    },
  });

  const items = threads.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('gmail.title')}</h1>
      <GmailNav />
      <p role="status" className="min-h-5 text-sm">
        {notice?.text}{' '}
        {notice?.projectId && (
          <Link to={`/projects/${notice.projectId}`} className="underline">
            {t('gmail.inbox.openProject')}
          </Link>
        )}
      </p>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {t('gmail.inbox.title')}
            {threads.data && <span className="ml-2 text-sm font-normal text-muted-foreground">{fill(t('gmail.inbox.count'), { n: threads.data.total })}</span>}
          </CardTitle>
          <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? t('gmail.sync.running') : t('gmail.sync.now')}
          </Button>
        </CardHeader>
        <CardContent>
          {threads.isPending && <p className="text-sm text-muted-foreground">…</p>}
          {threads.isError && <p className="text-sm text-destructive">{threads.error.message}</p>}
          {threads.data && items.length === 0 && <p className="text-sm text-muted-foreground">{t('gmail.inbox.empty')}</p>}
          {items.length > 0 && (
            <ul aria-label={t('gmail.inbox.title')} className="flex flex-col divide-y">
              {items.map((thread) => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  projects={projects.data?.items ?? []}
                  timeZone={tz}
                  onAssigned={(project) => setNotice({ text: fill(t('gmail.inbox.assigned'), { subject: thread.subject, project: project.name }), projectId: project.id })}
                />
              ))}
            </ul>
          )}
          {threads.data && threads.data.total > items.length && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLimit((l) => l + PAGE)}>
              {t('gmail.inbox.more')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ThreadItem({
  thread,
  projects,
  timeZone,
  onAssigned,
}: {
  thread: ThreadSummary;
  projects: Project[];
  timeZone: string;
  onAssigned: (project: Project) => void;
}) {
  const queryClient = useQueryClient();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(thread.suggestion?.projectId ?? '');
  const assign = useMutation({
    mutationFn: () => gmailApi.assign(thread.id, projectId),
    onSuccess: () => {
      const project = projects.find((p) => p.id === projectId);
      if (project) onAssigned(project);
      void queryClient.invalidateQueries({ queryKey: gmailKey });
    },
  });

  return (
    <li className="flex flex-col gap-2 py-3" data-thread={thread.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-medium break-words">{thread.subject || '–'}</h3>
        <StatusBadge status={thread.status} />
        {thread.deadline && <Tag className="text-destructive">{t('gmail.inbox.deadline')}</Tag>}
      </div>
      <p className="text-sm text-muted-foreground">
        {thread.participants.map(displayName).join(', ')} · {fill(t('gmail.inbox.messages'), { n: thread.messageCount })}
        {thread.attachmentCount > 0 && <> · {fill(t('gmail.inbox.attachments'), { n: thread.attachmentCount })}</>} ·{' '}
        <time dateTime={thread.lastMessageAt}>{formatDateTime(thread.lastMessageAt, timeZone)}</time> · {t('gmail.inbox.account')}: {thread.account}
      </p>
      {!open && thread.lastSnippet && <p className="line-clamp-2 text-sm break-words">{thread.lastSnippet}</p>}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="self-start text-sm text-primary hover:underline">
        {open ? `▾ ${t('gmail.inbox.hide')}` : `▸ ${t('gmail.inbox.show')}`}
      </button>
      {open && <ThreadMessages threadId={thread.id} timeZone={timeZone} />}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (projectId) assign.mutate();
        }}
      >
        <div className="flex min-w-56 flex-1 flex-col gap-1 sm:max-w-md">
          <Label htmlFor={selectId}>{t('gmail.inbox.project')}</Label>
          <Select id={selectId} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('gmail.inbox.chooseProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="sm" disabled={!projectId || assign.isPending}>
          {t('gmail.inbox.assign')}
        </Button>
        {thread.suggestion && (
          <span className="text-sm text-muted-foreground">
            {t('gmail.inbox.suggestion')}: {thread.suggestion.projectName}
          </span>
        )}
      </form>
      {assign.isError && <p className="text-sm text-destructive">{assign.error.message}</p>}
    </li>
  );
}

/** A szál levelei törzzsel (a megnyitás az auditnaplóba kerül). */
function ThreadMessages({ threadId, timeZone }: { threadId: string; timeZone: string }) {
  const thread = useQuery({ queryKey: [...gmailKey, 'thread', threadId], queryFn: () => gmailApi.thread(threadId) });
  if (thread.isPending) return <p className="text-sm text-muted-foreground">…</p>;
  if (thread.isError) return <p className="text-sm text-destructive">{thread.error.message}</p>;
  return (
    <ol className="flex flex-col gap-2">
      {thread.data.messages.map((m) => (
        <li key={m.id} className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="flex flex-wrap gap-x-2 text-muted-foreground">
            <Tag>{t(m.direction === 'in' ? 'gmail.message.in' : 'gmail.message.out')}</Tag>
            <span className="break-words">{m.from}</span>
            <time dateTime={m.sentAt}>{formatDateTime(m.sentAt, timeZone)}</time>
          </p>
          <div className="mt-1 whitespace-pre-wrap break-words">{m.bodyText || t('gmail.message.empty')}</div>
          {m.attachments.length > 0 && (
            <div className="mt-1">
              <AttachmentList items={m.attachments} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
