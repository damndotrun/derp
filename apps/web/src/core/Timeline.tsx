import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TimelineEvent } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { api } from './api.ts';
import { DefaultEvent } from './DefaultEvent.tsx';
import { formatDateTime, formatTime } from './format.ts';
import { fill, t, translate } from './i18n.ts';
import type { EventRenderer } from './module-types.ts';
import { registry, useModules } from './modules.ts';
import { groupTimeline, localDate, periodLabel, type EventNode, type Period, type TypeNode } from './timeline.ts';

/** Egy lapon ennyi esemény jön; a többit a görgetés tölti be. */
export const TIMELINE_PAGE_SIZE = 50;

type Level = 'period' | 'group';
interface ExpandState {
  /** Alapállapot szintenként: az időszakok kibontva, a típuscsoportok és a kapcsolódó események összecsukva. */
  defaults: Record<Level, boolean>;
  /** A felhasználó által egyenként átváltott csoportok. */
  overrides: Record<string, boolean>;
}
const INITIAL_EXPAND: ExpandState = { defaults: { period: true, group: false }, overrides: {} };

/** Az eseménytípus felirata: a mag típusainál a saját szótárból, a modulokénál a manifest `labelKey`-éből. */
function useTypeLabel(): (type: string) => string {
  const modules = useModules();
  return useMemo(() => {
    const keys = new Map<string, string>();
    for (const m of modules.data?.items ?? []) for (const e of m.eventTypes) keys.set(e.type, e.labelKey);
    return (type: string) => {
      const key = keys.get(type) ?? `eventType.${type}`;
      const label = translate(key);
      return label === key ? type : label;
    };
  }, [modules.data]);
}

/**
 * Projekt-idővonal: napi vagy heti, összecsukható csoportok, azon belül típus szerinti csoportok, típusszűrő,
 * „mindet kibont / összecsuk”, végtelen görgetés. Az élő frissítést a mag adja: új eseménynél a
 * `['projects', id, 'events']` kezdetű lekérdezések újratöltődnek (`stream.ts`). Az eseménytípus megjelenítőjét a
 * modul adja (`eventRenderers`), ha nincs, az alapértelmezett látszik.
 */
export function Timeline({
  projectId,
  timeZone,
  pageSize = TIMELINE_PAGE_SIZE,
  renderers = registry.eventRenderers,
}: {
  projectId: string;
  timeZone: string;
  pageSize?: number;
  renderers?: Record<string, EventRenderer>;
}) {
  const [period, setPeriod] = useState<Period>('day');
  const [byType, setByType] = useState(true);
  const [types, setTypes] = useState<string[]>([]);
  const [expand, setExpand] = useState<ExpandState>(INITIAL_EXPAND);
  const typeLabel = useTypeLabel();

  const events = useInfiniteQuery({
    queryKey: ['projects', projectId, 'events', { types, pageSize }],
    queryFn: ({ pageParam }) => api.projectEvents(projectId, { limit: pageSize, before: pageParam, types }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const typeCounts = useQuery({
    queryKey: ['projects', projectId, 'events', 'types'],
    queryFn: () => api.projectEventTypes(projectId),
  });

  const items = useMemo(() => events.data?.pages.flatMap((p) => p.items) ?? [], [events.data]);
  const groups = useMemo(() => groupTimeline(items, { timeZone, period, byType }), [items, timeZone, period, byType]);
  const today = localDate(new Date(), timeZone);

  const isOpen = (key: string, level: Level) => expand.overrides[key] ?? expand.defaults[level];
  const toggle = (key: string, level: Level) =>
    setExpand((s) => ({ ...s, overrides: { ...s.overrides, [key]: !(s.overrides[key] ?? s.defaults[level]) } }));
  const setAll = (open: boolean) => setExpand({ defaults: { period: open, group: open }, overrides: {} });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = events;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderEvent = (e: TimelineEvent) => {
    const Renderer = renderers[e.type] ?? DefaultEvent;
    return <Renderer event={e} timeZone={timeZone} />;
  };

  /** Egy esemény (és kibontva a kapcsolódó eseményei) a lista elemeiként. */
  const eventRows = ({ event, children }: EventNode, indent: number): ReactNode[] => {
    const relKey = `rel|${event.id}`;
    const relOpen = isOpen(relKey, 'group');
    const rows: ReactNode[] = [
      <li key={event.id} data-event-type={event.type} className={cn('border-l-2 border-primary/30 pl-3', indent && 'ml-4')}>
        {renderEvent(event)}
        {children.length > 0 && (
          <button
            type="button"
            aria-expanded={relOpen}
            onClick={() => toggle(relKey, 'group')}
            className="mt-1 text-sm text-primary hover:underline"
          >
            {relOpen ? '▾' : '▸'} {fill(t('timeline.related'), { n: children.length })}
          </button>
        )}
      </li>,
    ];
    if (relOpen) {
      for (const c of children) {
        rows.push(
          <li key={c.id} data-event-type={c.type} className={cn('border-l-2 border-primary/20 pl-3', indent ? 'ml-8' : 'ml-4')}>
            {renderEvent(c)}
          </li>,
        );
      }
    }
    return rows;
  };

  const typeRows = (node: TypeNode): ReactNode[] => {
    const open = isOpen(node.key, 'group');
    const newest = node.items[0]!.event.occurredAt;
    const count = node.items.reduce((n, i) => n + 1 + i.children.length, 0);
    const rows: ReactNode[] = [
      // A csoportfejléc nem listaelem (role="none"), így a lista elemei csak az események.
      <li key={node.key} role="none" data-group={node.key} className="border-l-2 border-primary/30 pl-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggle(node.key, 'group')}
          className="flex w-full flex-wrap items-baseline gap-x-2 text-left hover:underline"
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="font-medium">{typeLabel(node.type)}</span>
          <span className="text-sm text-muted-foreground">
            {fill(t('timeline.count'), { n: count })} ·{' '}
            {fill(t('timeline.latest'), { time: period === 'day' ? formatTime(newest, timeZone) : formatDateTime(newest, timeZone) })}
          </span>
        </button>
      </li>,
    ];
    if (open) for (const item of node.items) rows.push(...eventRows(item, 1));
    return rows;
  };

  const rows: ReactNode[] = [];
  for (const g of groups) {
    const open = isOpen(g.key, 'period');
    const label = periodLabel(g.key, period, today, {
      today: t('timeline.today'),
      yesterday: t('timeline.yesterday'),
      thisWeek: t('timeline.thisWeek'),
      lastWeek: t('timeline.lastWeek'),
      week: t('timeline.week'),
    });
    rows.push(
      <li key={`p|${g.key}`} role="none" data-period={g.key} className="mt-2 first:mt-0">
        <h3 className="text-base">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggle(g.key, 'period')}
            className="flex w-full flex-wrap items-baseline gap-x-2 rounded-md bg-muted/60 px-2 py-1 text-left font-semibold hover:bg-muted"
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
            <span>{label}</span>
            <span className="text-sm font-normal text-muted-foreground">{fill(t('timeline.count'), { n: g.count })}</span>
          </button>
        </h3>
      </li>,
    );
    if (open) for (const node of g.nodes) rows.push(...(node.kind === 'type' ? typeRows(node) : eventRows(node, 0)));
  }

  const availableTypes = typeCounts.data?.items ?? [];
  const toggleType = (type: string, on: boolean) =>
    setTypes((cur) => (on ? [...cur, type].sort() : cur.filter((x) => x !== type)));

  return (
    <section aria-label={t('timeline.title')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          {t('timeline.groupBy')}
          <Select className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="day">{t('timeline.byDay')}</option>
            <option value="week">{t('timeline.byWeek')}</option>
          </Select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={byType} onChange={(e) => setByType(e.target.checked)} />
          {t('timeline.byType')}
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)}>
            {t('timeline.expandAll')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)}>
            {t('timeline.collapseAll')}
          </Button>
        </div>
      </div>

      {availableTypes.length > 1 && (
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none">
            {t('timeline.filter')}
            {types.length > 0 && <span className="ml-2 rounded bg-primary px-1.5 text-xs text-primary-foreground">{types.length}</span>}
          </summary>
          <fieldset className="mt-2 flex flex-col gap-1.5">
            <legend className="sr-only">{t('timeline.filterTypes')}</legend>
            {availableTypes.map(({ type, count }) => (
              <div key={type} className="flex items-center gap-2">
                <input
                  id={`tl-type-${type}`}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={types.includes(type)}
                  onChange={(e) => toggleType(type, e.target.checked)}
                />
                <label htmlFor={`tl-type-${type}`}>{typeLabel(type)}</label>
                <span className="text-muted-foreground">({count})</span>
              </div>
            ))}
            {types.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setTypes([])}>
                {t('timeline.clearFilter')}
              </Button>
            )}
          </fieldset>
        </details>
      )}

      {events.isPending && <p>{t('common.loading')}</p>}
      {events.isError && <p className="text-destructive">{events.error.message}</p>}
      {events.isSuccess && items.length === 0 && (
        <p className="text-sm text-muted-foreground">{types.length > 0 ? t('timeline.noMatch') : t('events.empty')}</p>
      )}
      {items.length > 0 && (
        <ol aria-label={t('events.title')} aria-busy={events.isFetching} className="flex flex-col gap-3">
          {rows}
        </ol>
      )}
      {hasNextPage && (
        <div ref={sentinel}>
          <Button type="button" variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? t('timeline.loadingMore') : t('timeline.more')}
          </Button>
        </div>
      )}
    </section>
  );
}
