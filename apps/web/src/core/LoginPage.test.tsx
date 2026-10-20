import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage.tsx';

function renderLogin(session: { devLogin: boolean; googleLogin: boolean }, url = '/login') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ user: null, tzDisplay: 'Europe/Budapest', ...session })),
  );
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }], { initialEntries: [url] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('beállított Google-belépésnél a gomb a szerver indító végpontjára mutat', async () => {
    renderLogin({ devLogin: false, googleLogin: true });
    expect(await screen.findByRole('link', { name: 'Belépés Google-fiókkal' })).toHaveAttribute('href', '/api/auth/google');
    expect(screen.queryByRole('button', { name: 'Belépés (fejlesztői)' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Adatvédelmi tájékoztató' })).toHaveAttribute('href', '/adatvedelem');
  });

  it('a visszairányítás hibakódját magyarul mutatja', async () => {
    renderLogin({ devLogin: false, googleLogin: true }, '/login?error=not_allowed');
    expect(await screen.findByRole('alert')).toHaveTextContent('az e-mail-cím nincs felvéve');
  });

  it('ismeretlen hibakódot nem jelenít meg', async () => {
    renderLogin({ devLogin: true, googleLogin: false }, '/login?error=<script>');
    await screen.findByRole('button', { name: 'Belépés (fejlesztői)' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
