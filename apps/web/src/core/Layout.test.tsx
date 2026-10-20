import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleInfo } from '@derp/shared';
import { Layout } from './Layout.tsx';

const example: ModuleInfo = {
  id: 'example',
  version: '0.1.0',
  menu: [{ path: '/example', labelKey: 'example.menu' }],
  eventTypes: [{ type: 'example.pinged', labelKey: 'example.event.pinged' }],
  permissions: ['example.ping'],
};

function renderLayout(modules: ModuleInfo[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body =
        url === '/api/session'
          ? { user: { id: crypto.randomUUID(), email: 'a@derp.test', name: 'Admin Ádám', role: 'admin' }, devLogin: true, tzDisplay: 'Europe/Budapest' }
          : { items: modules };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const router = createMemoryRouter([{ path: '/', element: <Layout />, children: [{ index: true, element: <p>tartalom</p> }] }]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Layout menü', () => {
  it('a bekapcsolt modul menüpontja a mag menüpontjai után jelenik meg', async () => {
    renderLayout([example]);
    const nav = await screen.findByRole('navigation', { name: 'Főmenü' });
    expect(await within(nav).findByRole('link', { name: 'Minta modul' })).toHaveAttribute('href', '/example');
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Projektek', 'Minta modul']);
  });

  it('kikapcsolt modulnál nincs menüpont', async () => {
    renderLayout([]);
    const nav = await screen.findByRole('navigation', { name: 'Főmenü' });
    await within(nav).findByRole('link', { name: 'Projektek' });
    expect(within(nav).queryByRole('link', { name: 'Minta modul' })).toBeNull();
  });

  it('a menü gombbal nyílik és zárul (telefonos nézet)', async () => {
    renderLayout([example]);
    const open = await screen.findByRole('button', { name: 'Menü megnyitása' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Menü bezárása' }));
    expect(open).toHaveAttribute('aria-expanded', 'false');
  });
});
