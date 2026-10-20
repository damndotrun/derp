import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { t } from './i18n.ts';

/** A dokumentumtár kezdőlapja: a felhasználó által látható projektek (a terepesnek csak a hozzá rendeltek). */
export function DocsHomePage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('docs.title')}</h1>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('docs.chooseProject')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {projects.isPending && <p className="px-4 pb-4">{coreT('common.loading')}</p>}
          {projects.isError && <p className="px-4 pb-4 text-destructive">{projects.error.message}</p>}
          {projects.data?.items.length === 0 && <p className="px-4 pb-4 text-muted-foreground">{t('docs.noProjects')}</p>}
          <ul aria-label={t('docs.projects')} className="divide-y">
            {projects.data?.items.map((p) => (
              <li key={p.id}>
                <Link to={`/docs/${p.id}`} className="flex flex-col px-4 py-3 hover:bg-accent">
                  <span className="font-medium">{p.name}</span>
                  {p.client && <span className="text-sm text-muted-foreground">{p.client.name}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
