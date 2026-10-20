import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { api } from './api.ts';
import { t } from './i18n.ts';
import { useSession } from './session.ts';

export function Layout() {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (session.isPending) return <p className="p-6">{t('common.loading')}</p>;
  if (session.isError) return <p className="p-6 text-destructive">{t('common.error')}</p>;
  if (!session.data.user) return <Navigate to="/login" replace />;

  const logout = async () => {
    await api.logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-svh">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/projects" className="text-lg font-semibold">
            {t('app.name')}
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{session.data.user.name}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              {t('auth.logout')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
