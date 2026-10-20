import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useModules } from '@/core/modules.ts';
import { useSession, useUser } from '@/core/session.ts';
import { useLiveEvents } from '@/core/stream.ts';
import { cn } from '@/lib/utils';
import { fileUrls } from '../../docs/web/api.ts';
import { formatSize, isImage } from '../../docs/web/format.ts';
import { CHAT_EVENTS, type ChatAttachment, type ChatMessage, type MessagePage, type Person } from '../shared.ts';
import { chatApi, chatKey, unreadKey } from './api.ts';
import { t } from './i18n.ts';
import { matchPeople, mentionQuery, splitMentions } from './mentions.ts';
import { prepareMessage, sendMessage, type PreparedMessage } from './send.ts';

/** Egy projekt chatje: üzenetek (élőben frissül), olvasottság, írás @említéssel és csatolmánnyal. */
export function ProjectChatPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const user = useUser();
  const canPost = useModules().data?.items.find((m) => m.id === 'chat')?.permissions.includes('chat.post') ?? false;

  const project = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.project(projectId), retry: false });
  const messages = useInfiniteQuery({
    queryKey: chatKey(projectId),
    queryFn: ({ pageParam }) => chatApi.messages(projectId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last: MessagePage) => last.nextBefore ?? undefined,
    enabled: project.isSuccess,
  });
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: chatKey(projectId) }), [queryClient, projectId]);
  // Új üzenet, és a csatolmány feltöltése (más felhasználótól vagy más lapról) újratöltés nélkül megjelenik.
  useLiveEvents((e) => {
    if (e.projectId === projectId && (e.type === CHAT_EVENTS.messagePosted || e.type.startsWith('docs.'))) void refresh();
  });

  const items = useMemo(() => (messages.data?.pages ?? []).toReversed().flatMap((p) => p.items), [messages.data]);
  const latest = messages.data?.pages[0];
  useMarkRead(projectId, items.at(-1)?.seq ?? 0, latest?.lastReadSeq ?? 0);

  // Az „Új üzenetek” elválasztó a megnyitáskor olvasatlan első üzenet előtt marad.
  const firstUnread = useRef<number | null>(null);
  if (firstUnread.current === null && latest && user) {
    firstUnread.current = items.find((m) => m.seq > latest.lastReadSeq && m.author.id !== user.id)?.seq ?? Infinity;
  }

  if (project.isPending) return <p>{coreT('common.loading')}</p>;
  if (project.isError) {
    return (
      <LoadError
        error={project.error}
        notFound={t('chat.notFound')}
        forbidden={t('chat.forbidden')}
        back={{ to: '/chat', label: t('chat.backToList') }}
      />
    );
  }

  return (
    <div className="flex h-[calc(100svh-5.5rem)] flex-col gap-3 md:h-[calc(100svh-2rem)]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
            ← {t('chat.backToProject')}
          </Link>
          <h1 className="text-2xl font-semibold">{t('chat.title')}</h1>
          <p className="truncate text-muted-foreground">{project.data.name}</p>
        </div>
        <Link to={`/docs/${projectId}`} className="text-sm underline">
          {t('chat.openDocs')}
        </Link>
      </div>

      <MessageList
        items={items}
        page={latest}
        me={user?.id ?? ''}
        timeZone={tz}
        firstUnread={firstUnread.current ?? Infinity}
        loading={messages.isPending}
        error={messages.error}
        hasOlder={messages.hasNextPage}
        loadingOlder={messages.isFetchingNextPage}
        onOlder={() => void messages.fetchNextPage()}
      />

      {canPost && <Composer projectId={projectId} onSent={refresh} />}
    </div>
  );
}

/** Olvasottnak jelöli a legutolsó üzenetig, ha a lap látható (és amikor újra láthatóvá válik). */
function useMarkRead(projectId: string, newest: number, lastRead: number) {
  const queryClient = useQueryClient();
  const sent = useRef(0);
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== 'visible' || newest <= Math.max(lastRead, sent.current)) return;
      sent.current = newest;
      chatApi
        .markRead(projectId, newest)
        .then(() => queryClient.invalidateQueries({ queryKey: unreadKey }))
        .catch(() => {
          sent.current = 0;
        });
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [projectId, newest, lastRead, queryClient]);
}

function MessageList(props: {
  items: ChatMessage[];
  page: MessagePage | undefined;
  me: string;
  timeZone: string;
  firstUnread: number;
  loading: boolean;
  error: Error | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onOlder: () => void;
}) {
  const { items, page, me, timeZone, firstUnread } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const newest = items.at(-1)?.id;

  // Új üzenetnél (és megnyitáskor) az aljára görget.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest]);

  // „Látta: …” annál a (nem általa írt) üzenetnél, ameddig a másik felhasználó olvasott.
  const seenBy = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const r of page?.reads ?? []) {
      const at = items.findLast((m) => m.seq <= r.lastReadSeq && m.author.id !== r.user.id);
      if (at && r.lastReadSeq >= (items[0]?.seq ?? 0)) map.set(at.id, [...(map.get(at.id) ?? []), r.user]);
    }
    return map;
  }, [items, page]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-3">
      {props.hasOlder && (
        <div className="mb-3 flex justify-center">
          <Button variant="outline" size="sm" disabled={props.loadingOlder} onClick={props.onOlder}>
            {t('chat.older')}
          </Button>
        </div>
      )}
      {props.loading && <p>{coreT('common.loading')}</p>}
      {props.error && <p className="text-destructive">{props.error.message}</p>}
      {!props.loading && items.length === 0 && <p className="text-sm text-muted-foreground">{t('chat.empty')}</p>}
      <ol aria-label={t('chat.messages')} className="flex flex-col gap-3">
        {items.map((m) => (
          <li key={m.id} className="flex flex-col gap-1">
            {m.seq === firstUnread && (
              <div role="separator" className="my-1 flex items-center gap-2 text-xs font-medium text-primary">
                <span className="h-px flex-1 bg-primary/40" />
                {t('chat.newMessages')}
                <span className="h-px flex-1 bg-primary/40" />
              </div>
            )}
            <MessageItem message={m} own={m.author.id === me} timeZone={timeZone} />
            {seenBy.has(m.id) && (
              <p className={cn('text-xs text-muted-foreground', m.author.id === me && 'self-end')}>
                {t('chat.seenBy')}: {seenBy.get(m.id)!.map((p) => p.name).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MessageItem({ message: m, own, timeZone }: { message: ChatMessage; own: boolean; timeZone: string }) {
  return (
    <article
      aria-label={`${m.author.name}: ${m.body || m.attachments.map((a) => a.name).join(', ')}`}
      className={cn('flex max-w-[85%] flex-col gap-1 rounded-lg border px-3 py-2', own ? 'self-end bg-primary/10' : 'self-start bg-background')}
    >
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{m.author.name}</span> ·{' '}
        <time dateTime={m.createdAt}>{formatDateTime(m.createdAt, timeZone)}</time>
      </p>
      {m.body && <MessageBody body={m.body} mentions={m.mentions} />}
      {m.attachments.length > 0 && (
        <ul aria-label={t('chat.attachments')} className="flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <li key={a.id}>
              <Attachment attachment={a} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function MessageBody({ body, mentions }: { body: string; mentions: Person[] }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {splitMentions(body, mentions).map((s, i) =>
        s.mention ? (
          <strong key={i} className="font-semibold text-primary" data-mention={s.mention.id}>
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function Attachment({ attachment: a }: { attachment: ChatAttachment }) {
  if (a.status !== 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm text-muted-foreground">
        <span className={cn(a.status === 'deleted' && 'line-through')}>{a.name}</span> ({t(a.status === 'pending' ? 'chat.pending' : 'chat.deleted')})
      </span>
    );
  }
  const urls = fileUrls(a.id);
  if (a.hasThumb && a.mime && isImage(a.mime)) {
    return (
      <a href={urls.content} target="_blank" rel="noreferrer" className="block size-28 overflow-hidden rounded-md bg-muted">
        <img src={urls.thumb} alt={a.name} loading="lazy" className="h-full w-full object-cover" />
      </a>
    );
  }
  return (
    <a href={urls.download} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm underline">
      📎 {a.name}
      {a.size !== null && <span className="text-xs text-muted-foreground no-underline">({formatSize(a.size)})</span>}
    </a>
  );
}

/** Üzenetírás: Enter küld (Shift+Enter új sor), `@` után a projektet látó kollégák közül lehet választani. */
function Composer({ projectId, onSent }: { projectId: string; onSent: () => Promise<unknown> }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<PreparedMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const people = useQuery({ queryKey: ['chat', projectId, 'people'], queryFn: () => chatApi.people(projectId), staleTime: 60_000 });

  const mention = mentionQuery(text, caret);
  const candidates = mention ? matchPeople(people.data?.items ?? [], mention.query) : [];
  const listOpen = candidates.length > 0;

  const pick = (p: Person) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${p.name} ${text.slice(caret)}`;
    const pos = mention.start + p.name.length + 2;
    setText(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(pos, pos);
    });
  };

  // Az előkészített üzenet (azonosítókkal) hiba után változatlanul megy újra, így nem duplikál.
  const send = async (prepared?: PreparedMessage) => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const m = prepared ?? (await prepareMessage(projectId, text, files));
      setPending(m);
      await sendMessage(m);
      setPending(null);
      setText('');
      setFiles([]);
      await onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) void send(pending);
    else if (text.trim() || files.length > 0) void send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[Math.min(active, candidates.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        setCaret(-1);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const addFiles = (list: FileList | null) => {
    if (list) setFiles((f) => [...f, ...Array.from(list)]);
  };

  return (
    <form onSubmit={submit} className="relative flex flex-col gap-2">
      {listOpen && (
        <ul role="listbox" aria-label={t('chat.mentionList')} className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-md border bg-background shadow-md">
          {candidates.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={cn('cursor-pointer px-3 py-2 text-sm', i === active && 'bg-accent')}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul aria-label={t('chat.attachments')} className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm">
              📎 {f.name}
              {!pending && (
                <button
                  type="button"
                  aria-label={`${t('chat.removeAttachment')}: ${f.name}`}
                  className="px-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <label className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border hover:bg-accent" title={t('chat.attach')}>
          <span aria-hidden>📎</span>
          <input
            type="file"
            multiple
            className="sr-only"
            aria-label={t('chat.attach')}
            disabled={!!pending}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border hover:bg-accent md:hidden" title={t('chat.takePhoto')}>
          <span aria-hidden>📷</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={t('chat.takePhoto')}
            disabled={!!pending}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <Textarea
          ref={textarea}
          aria-label={t('chat.message')}
          placeholder={t('chat.placeholder')}
          rows={2}
          className="min-h-10 flex-1 resize-none"
          value={text}
          readOnly={!!pending}
          aria-expanded={listOpen}
          aria-autocomplete="list"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" disabled={sending || (!pending && !text.trim() && files.length === 0)}>
          {sending ? t('chat.sending') : pending ? t('chat.retry') : t('chat.send')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('chat.sendError')}: {error}
        </p>
      )}
    </form>
  );
}
