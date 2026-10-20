import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { ApiError } from './api.ts';
import { AuditPage } from './AuditPage.tsx';
import { ClientDetailPage } from './ClientDetailPage.tsx';
import { ClientsPage } from './ClientsPage.tsx';
import { Layout } from './Layout.tsx';
import { LoginPage } from './LoginPage.tsx';
import { ModuleGate } from './ModuleGate.tsx';
import { registry } from './modules.ts';
import { outbox } from './outbox.ts';
import { ProjectDetailPage } from './ProjectDetailPage.tsx';
import { ProjectsPage } from './ProjectsPage.tsx';
import { RoleGate } from './RoleGate.tsx';
import { sessionKey } from './session.ts';
import { UsersPage } from './UsersPage.tsx';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    // A lekérdezés offline is elindul: a service worker a tárolt választ adja (terepi mód); ha nincs, hibát mutat.
    queries: {
      networkMode: 'always',
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
    mutations: { networkMode: 'always' },
  },
});

// Ha az offline sor 401-et kap, a munkamenet újraellenőrzése a belépő oldalra visz (a sor megmarad).
outbox.onAuthRequired = () => void queryClient.invalidateQueries({ queryKey: sessionKey });

// Lejárt munkamenetnél (401) a session újratöltése a belépő oldalra visz.
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== sessionKey[0]) {
    void queryClient.invalidateQueries({ queryKey: sessionKey });
  }
});

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      {
        path: 'clients',
        element: (
          <RoleGate roles={['admin', 'iroda']}>
            <ClientsPage />
          </RoleGate>
        ),
      },
      {
        path: 'clients/:id',
        element: (
          <RoleGate roles={['admin', 'iroda']}>
            <ClientDetailPage />
          </RoleGate>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <RoleGate roles={['admin']}>
            <UsersPage />
          </RoleGate>
        ),
      },
      {
        path: 'admin/audit',
        element: (
          <RoleGate roles={['admin']}>
            <AuditPage />
          </RoleGate>
        ),
      },
      // A modulok oldalai; kikapcsolt modulnál a kapu „nincs bekapcsolva” jelzést ad.
      ...registry.routes.map(({ path, Component, moduleId }) => ({
        path: path.replace(/^\//, ''),
        element: (
          <ModuleGate moduleId={moduleId}>
            <Component />
          </ModuleGate>
        ),
      })),
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
