import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventList, ModuleInfo, TimelineEvent } from '@derp/shared';
import { Timeline } from './Timeline.tsx';

const PROJECT = '11111111-1111-4111-8111-111111111111';
let n = 0;
const ev = (occurredAt: string, over: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  projectId: PROJECT,
  type: 'core.project_updated',
  source: 'user',
  occurredAt,
  actor: null,
  title: 'Projekt módosítva',
  data: {},
  parentId: null,
  ...over,
});

const example: ModuleInfo = {
  id: 'example',
  version: '0.1.0',
  menu: [],
  eventTypes: [{ type: 'example.pinged', labelKey: 'example.event.pinged' }],
  permissions: [],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A szerver utánzata: lapozás `limit`/`before` szerint, szűrés `types` szerint; a kéréseket naplózza. */
function serve(all: TimelineEvent[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(input);
      const url = new URL(input, 'http://x');
      if (url.pathname === '/api/modules') return json({ items: [example] });
      if (url.pathname.endsWith('/event-types')) {
        const counts = new Map<string, number>();
        for (const e of all) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
        return json({ items: [...counts].sort().map(([type, count]) => ({ type, count })) });
      }
      const types = url.searchParams.get('types')?.split(',') ?? [];
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const before = url.searchParams.get('before');
      let list = all.filter((e) => types.length === 0 || types.includes(e.type));
      if (before) list = list.slice(list.findIndex((e) => e.id === before) + 1);
      const page: EventList = { items: list.slice(0, limit), nextCursor: list.length > limit ? list[limit - 1]!.id : null };
      return json(page);
    }),
  );
  return urls;
}

function renderTimeline(pageSize?: number) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Timeline projectId={PROJECT} timeZone="Europe/Budapest" pageSize={pageSize} />
    </QueryClientProvider>,
  );
}

const visibleEvents = () => within(screen.getByRole('list', { name: 'Események' })).queryAllByRole('listitem');

afterEach(() => vi.unstubAllGlobals());

// Időrendben fordítva, ahogy a szerver adja. Két napra (október 20. és 19.) és két hétre (43. és 42.) esnek.
const EVENTS = [
  ev('2026-10-20T12:00:00Z', { type: 'example.pinged', title: 'Minta esemény' }),
  ev('2026-10-20T11:00:00Z', { title: 'Módosítás 3' }),
  ev('2026-10-20T10:00:00Z', { title: 'Módosítás 2' }),
  ev('2026-10-19T10:00:00Z', { title: 'Módosítás 1' }),
  ev('2026-10-15T10:00:00Z', { type: 'core.project_created', title: 'Projekt létrehozva' }),
];

describe('Timeline', () => {
  it('napi csoportokba tesz, a típuscsoport összecsukva indul, kibontható', async () => {
    serve(EVENTS);
    renderTimeline();
    const day = await screen.findByRole('button', { name: /2026\. október 20\., kedd/ });
    expect(day).toHaveAttribute('aria-expanded', 'true');
    expect(day).toHaveTextContent('3 esemény');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining('október 20.'),
      expect.stringContaining('október 19.'),
      expect.stringContaining('október 15.'),
    ]);
    // Látszik: a minta esemény, a 19-i és a 15-i; a két 20-i módosítás egy összecsukott csoportban van.
    expect(visibleEvents().map((li) => li.querySelector('p')?.textContent)).toEqual(['Minta esemény', 'Módosítás 1', 'Projekt létrehozva']);
    const group = screen.getByRole('button', { name: /Projekt módosítva.*2 esemény/ });
    expect(group).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(group);
    expect(visibleEvents()).toHaveLength(5);
    await userEvent.click(day);
    expect(day).toHaveAttribute('aria-expanded', 'false');
    expect(visibleEvents().map((li) => li.querySelector('p')?.textContent)).toEqual(['Módosítás 1', 'Projekt létrehozva']);
  });

  it('a modul eseménytípusának felirata a manifestből jön; mindet összecsuk / kibont', async () => {
    serve(EVENTS);
    renderTimeline();
    await screen.findByRole('button', { name: /október 20\./ });
    await userEvent.click(screen.getByRole('button', { name: 'Mindet összecsuk' }));
    expect(visibleEvents()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Mindet kibont' }));
    expect(visibleEvents()).toHaveLength(5);
    await userEvent.click(screen.getByText('Szűrés típus szerint'));
    expect(screen.getByRole('checkbox', { name: 'Minta esemény' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Projekt létrehozva' })).toBeInTheDocument();
  });

  it('heti csoportosításnál a hétfő kezdi a hetet; típus szerinti csoportosítás kikapcsolható', async () => {
    serve(EVENTS);
    renderTimeline();
    await screen.findByRole('button', { name: /október 20\./ });
    await userEvent.selectOptions(screen.getByLabelText('Csoportosítás'), 'Hetek');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining('43. hét · 2026. október 19–25.4 esemény'),
      expect.stringContaining('42. hét · 2026. október 12–18.1 esemény'),
    ]);
    // A 43. héten a három módosítás egy csoport.
    expect(screen.getByRole('button', { name: /Projekt módosítva.*3 esemény/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Típus szerint' }));
    expect(visibleEvents()).toHaveLength(5);
  });

  it('a típusszűrő a szervertől kéri a szűrt listát', async () => {
    const urls = serve(EVENTS);
    renderTimeline();
    await screen.findByRole('button', { name: /október 20\./ });
    await userEvent.click(screen.getByText('Szűrés típus szerint'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Projekt létrehozva' }));
    expect(await screen.findByRole('button', { name: /október 15\./ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /október 20\./ })).not.toBeInTheDocument();
    expect(visibleEvents().map((li) => li.querySelector('p')?.textContent)).toEqual(['Projekt létrehozva']);
    expect(urls.some((u) => u.includes('types=core.project_created'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Szűrő törlése' }));
    expect(await screen.findByRole('button', { name: /október 20\./ })).toBeInTheDocument();
  });

  it('a további lapokat a kurzorral tölti be', async () => {
    const urls = serve(EVENTS);
    renderTimeline(2);
    await screen.findByRole('button', { name: /október 20\./ });
    expect(screen.queryByRole('button', { name: /október 19\./ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Továbbiak betöltése' }));
    expect(await screen.findByRole('button', { name: /október 19\./ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Továbbiak betöltése' }));
    expect(await screen.findByRole('button', { name: /október 15\./ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Továbbiak betöltése' })).not.toBeInTheDocument();
    expect(urls.filter((u) => u.includes('before='))).toHaveLength(2);
  });

  it('a kapcsolódó események a szülő alatt, összecsukva', async () => {
    const survey = ev('2026-10-20T10:00:00Z', { type: 'example.pinged', title: 'Felmérés' });
    serve([ev('2026-10-20T10:00:02Z', { type: 'core.project_updated', title: 'Fotó', parentId: survey.id }), survey]);
    renderTimeline();
    const related = await screen.findByRole('button', { name: /1 kapcsolódó/ });
    expect(visibleEvents().map((li) => li.querySelector('p')?.textContent)).toEqual(['Felmérés']);
    await userEvent.click(related);
    expect(visibleEvents().map((li) => li.querySelector('p')?.textContent)).toEqual(['Felmérés', 'Fotó']);
  });

  it('üres idővonal', async () => {
    serve([]);
    renderTimeline();
    expect(await screen.findByText('Még nincs esemény.')).toBeInTheDocument();
  });
});
