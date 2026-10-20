import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventList } from '@/core/EventList.tsx';

describe('example.pinged megjelenítő', () => {
  it('az idővonalon a címet és az üdvözlő szöveget mutatja', () => {
    render(
      <EventList
        timeZone="Europe/Budapest"
        events={[
          {
            id: crypto.randomUUID(),
            projectId: crypto.randomUUID(),
            type: 'example.pinged',
            source: 'user',
            occurredAt: '2026-10-20T10:00:00.000Z',
            actor: { id: crypto.randomUUID(), name: 'Admin Ádám' },
            title: 'Minta esemény',
            data: { greeting: 'Szia!' },
            parentId: null,
          },
        ]}
      />,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Minta esemény');
    expect(item).toHaveTextContent('Admin Ádám');
    expect(item).toHaveTextContent('Szia!');
  });
});
