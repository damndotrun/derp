import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteForm, SurveyForm } from './Forms.tsx';

afterEach(() => vi.unstubAllGlobals());

describe('felmérés-űrlap', () => {
  it('a kötelező mezők nélkül nem küld, és mezőnként jelzi a hibát', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SurveyForm projectId={crypto.randomUUID()} onSaved={() => {}} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Felmérés mentése' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Töltsd ki a kötelező mezőket.');
    for (const label of ['Helyszín *', 'Észlelt állapot *', 'Javasolt munka *', 'Megnevezés 1', 'Mennyiség 1']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
    // Az egység alapból „db”.
    expect(screen.getByLabelText('Egység 1')).toHaveValue('db');
    expect(screen.getByLabelText('Egység 1')).toHaveAttribute('aria-invalid', 'false');

    await user.type(screen.getByLabelText('Mennyiség 1'), 'sok');
    expect(screen.getByLabelText('Mennyiség 1')).toHaveAccessibleDescription('Pozitív szám kell (pl. 2,5).');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('kitöltve elküldi a felmérést; a tételek sorrendben, a mennyiség magyar tizedesvesszővel is jó', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ id: 's', eventId: 'e' }), { status: 201, headers: { 'content-type': 'application/json' } });
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<SurveyForm projectId={crypto.randomUUID()} onSaved={onSaved} onCancel={() => {}} />);
    await user.type(screen.getByLabelText('Helyszín *'), 'Gépház');
    await user.type(screen.getByLabelText('Észlelt állapot *'), 'Zajos ventilátor');
    await user.type(screen.getByLabelText('Javasolt munka *'), 'Csere');
    await user.type(screen.getByLabelText('Megnevezés 1'), 'Ventilátor');
    await user.type(screen.getByLabelText('Mennyiség 1'), '1');
    await user.click(screen.getByRole('button', { name: '+ Tétel hozzáadása' }));
    await user.type(screen.getByLabelText('Megnevezés 2'), 'Légcsatorna');
    await user.type(screen.getByLabelText('Mennyiség 2'), '2,5');
    await user.clear(screen.getByLabelText('Egység 2'));
    await user.type(screen.getByLabelText('Egység 2'), 'fm');
    await user.click(screen.getByRole('button', { name: 'Felmérés mentése' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies).toEqual([
      {
        location: 'Gépház',
        condition: 'Zajos ventilátor',
        proposedWork: 'Csere',
        materials: [
          { name: 'Ventilátor', quantity: 1, unit: 'db' },
          { name: 'Légcsatorna', quantity: 2.5, unit: 'fm' },
        ],
        photos: [],
      },
    ]);
  });

  it('hiba után az „Újra” ugyanazzal az azonosítóval küld', async () => {
    const urls: string[] = [];
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (fail) {
          fail = false;
          return new Response(JSON.stringify({ error: { code: 'http', message: 'Szerverhiba' } }), { status: 500, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'n' }), { status: 201, headers: { 'content-type': 'application/json' } });
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<NoteForm projectId={crypto.randomUUID()} onSaved={onSaved} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Jegyzet mentése' }));
    expect(screen.getByLabelText('Jegyzet *')).toHaveAccessibleDescription('Kötelező mező.');
    expect(urls).toHaveLength(0);

    await user.type(screen.getByLabelText('Jegyzet *'), 'Kapukód: 1234');
    await user.click(screen.getByRole('button', { name: 'Jegyzet mentése' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A mentés nem sikerült');
    await user.click(screen.getByRole('button', { name: 'Újra' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(urls[0]);
  });
});
