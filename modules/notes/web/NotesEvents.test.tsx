import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { EventList } from '@/core/EventList.tsx';

describe('jegyzet és felmérés az idővonalon', () => {
  it('a felmérés eseménye a mezőkkel, darabszámokkal és linkkel a felmérésre; a jegyzet a szövegével', () => {
    const projectId = crypto.randomUUID();
    const surveyId = crypto.randomUUID();
    const base = { projectId, source: 'user', occurredAt: '2026-10-20T10:00:00.000Z', actor: { id: crypto.randomUUID(), name: 'Terepes Tamás' }, parentId: null };
    const element = (
      <EventList
        timeZone="Europe/Budapest"
        events={[
          {
            ...base,
            id: crypto.randomUUID(),
            type: 'notes.survey_added',
            title: 'Felmérés: Gépház',
            data: {
              surveyId,
              location: 'Gépház',
              condition: 'Zajos ventilátor',
              proposedWork: 'Ventilátorcsere',
              materials: [{ name: 'Ventilátor', quantity: 1, unit: 'db' }],
              photos: 2,
            },
          },
          { ...base, id: crypto.randomUUID(), type: 'notes.note_added', title: 'Helyszíni jegyzet: Kapukód', data: { noteId: crypto.randomUUID(), body: 'Kapukód: 1234' } },
        ]}
      />
    );
    render(<RouterProvider router={createMemoryRouter([{ path: '/', element }])} />);
    const [survey, note] = screen.getAllByRole('listitem');
    expect(survey).toHaveTextContent('Észlelt állapot: Zajos ventilátor');
    expect(survey).toHaveTextContent('Javasolt munka: Ventilátorcsere');
    expect(survey).toHaveTextContent('1 anyagtétel · 2 fotó');
    expect(screen.getByRole('link', { name: 'Felmérés megnyitása' })).toHaveAttribute('href', `/notes/${projectId}/surveys/${surveyId}`);
    expect(note).toHaveTextContent('Kapukód: 1234');
  });
});
