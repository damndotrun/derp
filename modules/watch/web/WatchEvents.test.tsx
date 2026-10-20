import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@derp/shared';
import { EventList } from '@/core/EventList.tsx';
import { fill, formatSize } from './format.ts';
import { FILE_LIST_LIMIT, FileList } from './ProjectWatchPage.tsx';

const event = (type: string, title: string, data: Record<string, unknown>): TimelineEvent => ({
  id: crypto.randomUUID(),
  projectId: 'p1',
  type,
  source: 'filesystem',
  occurredAt: '2026-10-20T10:00:00.000Z',
  actor: null,
  title,
  data,
  parentId: null,
});

const data = (extra: Record<string, unknown> = {}) => ({
  fileId: 'f1',
  path: 'Árlisták/arlista_beszallito.pdf',
  name: 'arlista_beszallito.pdf',
  size: 2_400_000,
  mtime: '2026-10-20T09:58:00.000Z',
  ...extra,
});

const show = (events: TimelineEvent[]) =>
  render(
    <MemoryRouter>
      <EventList timeZone="Europe/Budapest" events={events} />
    </MemoryRouter>,
  );

describe('watch eseménymegjelenítők', () => {
  it('„Új fájl a szerveren”: útvonal, méret, letöltés-link', () => {
    show([event('watch.file_added', 'Új fájl a szerveren: arlista_beszallito.pdf', data())]);
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Új fájl a szerveren: arlista_beszallito.pdf');
    expect(item).toHaveTextContent('Árlisták/arlista_beszallito.pdf');
    expect(item).toHaveTextContent('2,3 MB');
    const link = within(item).getByRole('link', { name: 'Letöltés' });
    expect(link).toHaveAttribute('href', '/api/watch/files/f1/content');
    expect(link).toHaveAttribute('download', 'arlista_beszallito.pdf');
  });

  it('törölt fájlnál nincs letöltés; átnevezésnél a korábbi útvonal is látszik', () => {
    show([
      event('watch.file_deleted', 'Fájl törölve a szerverről: a.pdf', data({ fileId: 'f2', path: 'a.pdf', name: 'a.pdf' })),
      event('watch.file_renamed', 'Fájl átnevezve a szerveren: a.pdf → b.pdf', data({ fileId: 'f3', path: 'b.pdf', name: 'b.pdf', oldPath: 'a.pdf' })),
    ]);
    const [deleted, renamed] = screen.getAllByRole('listitem');
    expect(within(deleted!).queryByRole('link')).toBeNull();
    expect(renamed).toHaveTextContent('Korábban: a.pdf');
    expect(within(renamed!).getByRole('link', { name: 'Letöltés' })).toHaveAttribute('href', '/api/watch/files/f3/content');
  });

  it('hiányos adatnál az alapértelmezett megjelenítő', () => {
    show([event('watch.file_added', 'Új fájl a szerveren: x', {})]);
    expect(screen.getByRole('listitem')).toHaveTextContent('Új fájl a szerveren: x');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('fájllista', () => {
  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `f${i}`,
      projectId: 'p1',
      path: `Mappa/fajl-${String(i).padStart(4, '0')}.pdf`,
      size: 1000,
      mtime: '2026-10-20T09:58:00.000Z',
    }));

  it('letöltés-linkek, szűrés név szerint, nagy mappánál korlátozott lista', () => {
    render(<FileList files={files(FILE_LIST_LIMIT + 20)} timeZone="Europe/Budapest" />);
    const list = screen.getByRole('list', { name: 'Fájlok a szerveren' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(FILE_LIST_LIMIT);
    expect(screen.getByText(`Az első ${FILE_LIST_LIMIT} látszik a(z) ${FILE_LIST_LIMIT + 20} közül; szűkíts a szűrővel.`)).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Letöltés: Mappa/fajl-0000.pdf' })).toHaveAttribute('href', '/api/watch/files/f0/content');

    fireEvent.change(screen.getByLabelText('Szűrés név szerint'), { target: { value: 'FAJL-051' } });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent?.slice(0, 19))).toEqual(
      Array.from({ length: 10 }, (_, i) => `Mappa/fajl-051${i}.pdf`),
    );
  });

  it('üres mappa', () => {
    render(<FileList files={[]} timeZone="Europe/Budapest" />);
    expect(screen.getByText('A mappában nincs fájl.')).toBeInTheDocument();
  });
});

describe('formázás', () => {
  it('méret és helyőrzők', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(fill('{a} új, {b} törölt, {c}', { a: 1, b: 0 })).toBe('1 új, 0 törölt, {c}');
  });
});
