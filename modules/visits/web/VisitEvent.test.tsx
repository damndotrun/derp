import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventList } from '@/core/EventList.tsx';

describe('kiszállás-események az idővonalon', () => {
  it('a „Kiszállás ütemezve” eseménynél a nap, az időtartam, a kollégák, a cím és a feladat látszik', () => {
    render(
      <EventList
        timeZone="Europe/Budapest"
        events={[
          {
            id: crypto.randomUUID(),
            projectId: crypto.randomUUID(),
            type: 'visits.scheduled',
            source: 'user',
            occurredAt: '2026-10-20T08:00:00.000Z',
            actor: { id: crypto.randomUUID(), name: 'Iroda Ildi' },
            title: 'Kiszállás ütemezve',
            data: {
              visitId: crypto.randomUUID(),
              startsAt: '2026-10-21T07:00:00.000Z',
              endsAt: '2026-10-21T09:30:00.000Z',
              address: 'Kecskemét, Fő utca 1.',
              task: 'Légtechnikai felmérés',
              status: 'utemezett',
              assignees: [{ id: crypto.randomUUID(), name: 'Terepes Tamás' }],
            },
            parentId: null,
          },
        ]}
      />,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Kiszállás ütemezve');
    expect(item).toHaveTextContent('Iroda Ildi');
    expect(item).toHaveTextContent('2026. október 21., szerda 09:00–11:30');
    expect(item).toHaveTextContent('Terepes Tamás');
    expect(item).toHaveTextContent('Kecskemét, Fő utca 1.');
    expect(item).toHaveTextContent('Légtechnikai felmérés');
  });
});
