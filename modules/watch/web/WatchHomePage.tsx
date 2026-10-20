import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { mappingsKey, watchApi } from './api.ts';
import { t } from './i18n.ts';

/** A szerver-mappák kezdőlapja: a látható projektek (a terepesnek csak a hozzá rendeltek) és a hozzárendelt mappájuk. */
export function WatchHomePage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const mappings = useQuery({ queryKey: mappingsKey, queryFn: watchApi.mappings });
  const byProject = new Map((mappings.data?.items ?? []).map((m) => [m.projectId, m]));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('watch.homeTitle')}</h1>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{t('watch.chooseProject')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {projects.isPending && <p className="px-4 pb-4">{coreT('common.loading')}</p>}
          {projects.isError && <p className="px-4 pb-4 text-destructive">{projects.error.message}</p>}
          {projects.data?.items.length === 0 && <p className="px-4 pb-4 text-muted-foreground">{t('watch.noProjects')}</p>}
          <ul aria-label={t('watch.projects')} className="divide-y">
            {projects.data?.items.map((p) => {
              const m = byProject.get(p.id);
              return (
                <li key={p.id}>
                  <Link to={`/watch/${p.id}`} className="flex flex-col px-4 py-3 hover:bg-accent">
                    <span className="font-medium">{p.name}</span>
                    <span className="break-all text-sm text-muted-foreground">
                      {m ? `${m.path} · ${m.fileCount} ${t('watch.fileCount')}` : t('watch.noMapping')}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
