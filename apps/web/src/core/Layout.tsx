import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { User } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from './api.ts';
import { t, translate } from './i18n.ts';
import { useModules } from './modules.ts';
import { useSession } from './session.ts';
import { useEventStream } from './stream.ts';

export function Layout() {
  const session = useSession();

  if (session.isPending) return <p className="p-6">{t('common.loading')}</p>;
  if (session.isError) return <p className="p-6 text-destructive">{t('common.error')}</p>;
  if (!session.data.user) return <Navigate to="/login" replace />;
  return <Shell user={session.data.user} />;
}

interface MenuItem {
  path: string;
  label: string;
}

/** A mag menüpontjai, utána a bekapcsolt modulok menüpontjai a `GET /api/modules` sorrendjében. */
export function useMenuItems(): MenuItem[] {
  const modules = useModules();
  return [
    { path: '/projects', label: t('nav.projects') },
    ...(modules.data?.items ?? []).flatMap((m) => m.menu.map((i) => ({ path: i.path, label: translate(i.labelKey) }))),
  ];
}

/** Reszponzív váz: asztalon állandó oldalsáv, telefonon fejléc és lenyíló (kicsúszó) menü. */
function Shell({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const items = useMenuItems();
  const [open, setOpen] = useState(false);
  useEventStream(true);

  useEffect(() => setOpen(false), [location.pathname]);

  const logout = async () => {
    await api.logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-svh md:flex">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-2 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.open')}
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </Button>
        <Link to="/projects" className="text-lg font-semibold">
          {t('app.name')}
        </Link>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={() => setOpen(false)} />}

      <aside
        id="main-nav"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background transition-transform',
          'md:visible md:sticky md:top-0 md:h-svh md:w-56 md:shrink-0 md:translate-x-0',
          open ? 'visible translate-x-0' : 'invisible -translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/projects" className="text-lg font-semibold">
            {t('app.name')}
          </Link>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.close')} onClick={() => setOpen(false)}>
            <CloseIcon />
          </Button>
        </div>
        <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto px-2">
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    cn('block rounded-md px-3 py-2 text-sm hover:bg-accent', isActive && 'bg-accent font-medium')
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center justify-between gap-2 border-t p-3 text-sm">
          <span className="truncate text-muted-foreground">{user.name}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            {t('auth.logout')}
          </Button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl min-w-0 flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
