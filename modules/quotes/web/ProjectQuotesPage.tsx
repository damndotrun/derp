import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useSession } from '@/core/session.ts';
import { projectQuotesKey, quotesApi } from './api.ts';
import { t } from './i18n.ts';
import { QuoteList } from './QuoteList.tsx';

/** Egy projekt árajánlatai és „Új árajánlat”. */
export function ProjectQuotesPage() {
  const { projectId = '' } = useParams();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const navigate = useNavigate();
  const project = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.project(projectId), retry: false });
  const list = useQuery({ queryKey: projectQuotesKey(projectId), queryFn: () => quotesApi.project(projectId), enabled: project.isSuccess, retry: false });
  const create = useMutation({ mutationFn: () => quotesApi.create(projectId), onSuccess: (q) => navigate(`/quotes/${q.id}`) });

  if (project.isPending) return <p>{coreT('common.loading')}</p>;
  const error = project.error ?? list.error;
  if (error) {
    return <LoadError error={error} notFound={t('quotes.projectNotFound')} forbidden={t('quotes.forbidden')} back={{ to: `/projects/${projectId}`, label: t('quotes.backToProject') }} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
            ← {t('quotes.backToProject')}
          </Link>
          <h1 className="text-2xl font-semibold">{t('quotes.title')}</h1>
          <p className="truncate text-muted-foreground">{project.data!.name}</p>
        </div>
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          + {create.isPending ? t('quotes.creating') : t('quotes.new')}
        </Button>
      </div>
      {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
      <Card>
        <CardContent className="p-0">
          {list.isPending && <p className="p-4">{coreT('common.loading')}</p>}
          {list.data?.items.length === 0 && <p className="p-4 text-muted-foreground">{t('quotes.projectEmpty')}</p>}
          {list.data && <QuoteList items={list.data.items} timeZone={tz} />}
        </CardContent>
      </Card>
    </div>
  );
}
