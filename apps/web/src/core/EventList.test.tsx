import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@derp/shared';
import { EventList } from './EventList.tsx';

const event = (over: Partial<TimelineEvent>): TimelineEvent => ({
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  type: 'core.project_created',
  source: 'user',
  occurredAt: '2026-10-20T10:00:00.000Z',
  actor: { id: crypto.randomUUID(), name: 'Admin Ádám' },
  title: 'Projekt létrehozva',
  data: {},
  parentId: null,
  ...over,
});

describe('EventList', () => {
  it('kiírja a címet, a helyi időt és a szereplőt', () => {
    render(<EventList events={[event({})]} timeZone="Europe/Budapest" />);
    const item = within(screen.getByRole('list', { name: 'Események' })).getByRole('listitem');
    expect(item).toHaveTextContent('Projekt létrehozva');
    expect(item).toHaveTextContent('2026. 10. 20. 12:00');
    expect(item).toHaveTextContent('Admin Ádám');
  });

  it('a kapott sorrendet tartja, szereplő nélkül is', () => {
    render(
      <EventList
        events={[event({ title: 'Projekt módosítva', actor: null }), event({ title: 'Projekt létrehozva' })]}
        timeZone="Europe/Budapest"
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual(['Projekt módosítva', 'Projekt létrehozva']);
    expect(items[0]).not.toHaveTextContent('·');
  });

  it('üres listánál jelzi, hogy nincs esemény', () => {
    render(<EventList events={[]} timeZone="Europe/Budapest" />);
    expect(screen.getByText('Még nincs esemény.')).toBeInTheDocument();
  });
});
