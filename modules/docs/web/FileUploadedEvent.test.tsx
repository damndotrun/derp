import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@derp/shared';
import { EventList } from '@/core/EventList.tsx';
import { folderOptions } from './ProjectDocsPage.tsx';
import { extensionLabel, formatSize } from './format.ts';

const event = (data: Record<string, unknown>, title = 'Fotó feltöltve: gépház.jpg'): TimelineEvent => ({
  id: crypto.randomUUID(),
  projectId: 'p1',
  type: 'docs.file_uploaded',
  source: 'user',
  occurredAt: '2026-10-20T10:00:00.000Z',
  actor: { id: crypto.randomUUID(), name: 'Terepes Tamás' },
  title,
  data,
  parentId: null,
});

describe('docs.file_uploaded megjelenítő', () => {
  it('a bélyegképet mutatja, kattintva a fájl nyílik; link a dokumentumtár mappájára', () => {
    render(
      <MemoryRouter>
        <EventList timeZone="Europe/Budapest" events={[event({ fileId: 'f1', name: 'gépház.jpg', mime: 'image/jpeg', size: 1, folderId: 'd1', thumb: true })]} />
      </MemoryRouter>,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Fotó feltöltve: gépház.jpg');
    expect(item).toHaveTextContent('Terepes Tamás');
    const img = within(item).getByRole('img', { name: 'gépház.jpg' });
    expect(img).toHaveAttribute('src', '/api/docs/files/f1/thumb');
    expect(img.closest('a')).toHaveAttribute('href', '/api/docs/files/f1/content');
    expect(within(item).getByRole('link', { name: 'Megnyitás a dokumentumtárban' })).toHaveAttribute('href', '/docs/p1?folder=d1');
  });

  it('bélyegkép nélküli fájlnál csak a cím és a link', () => {
    render(
      <MemoryRouter>
        <EventList timeZone="Europe/Budapest" events={[event({ fileId: 'f2', name: 'a.pdf', mime: 'application/pdf', size: 1, folderId: null, thumb: false }, 'Fájl feltöltve: a.pdf')]} />
      </MemoryRouter>,
    );
    const item = screen.getByRole('listitem');
    expect(within(item).queryByRole('img')).toBeNull();
    expect(within(item).getByRole('link', { name: 'Megnyitás a dokumentumtárban' })).toHaveAttribute('href', '/docs/p1');
  });
});

describe('segédek', () => {
  it('fájlméret és kiterjesztés', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(25 * 1024 * 1024)).toBe('25 MB');
    expect(extensionLabel('Alaprajz.dwg')).toBe('DWG');
    expect(extensionLabel('nincs')).toBe('?');
  });

  it('a mappák fa-sorrendben, mélységgel', () => {
    const f = (id: string, name: string, parentId: string | null) => ({ id, name, parentId, projectId: 'p', version: 1, createdAt: '' });
    const opts = folderOptions([f('b', 'Rajzok', null), f('a', 'Fotók', null), f('c', 'Gépház', 'a')]);
    expect(opts.map((o) => `${o.depth}:${o.folder.name}`)).toEqual(['0:Fotók', '1:Gépház', '0:Rajzok']);
  });
});
