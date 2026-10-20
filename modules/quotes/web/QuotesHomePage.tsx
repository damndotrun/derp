import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/core/api.ts';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useSession } from '@/core/session.ts';
import { quotesApi, quotesKey } from './api.ts';
import { t } from './i18n.ts';
import { QuoteList } from './QuoteList.tsx';

/** Az árajánlatok kezdőlapja: új ajánlat egy projekthez, és minden ajánlat a legutóbb módosítottal kezdve. */
export function QuotesHomePage() {
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const navigate = useNavigate();
  const list = useQuery({ queryKey: [...quotesKey, 'all'], queryFn: quotesApi.list, retry: false });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [projectId, setProjectId] = useState('');
  const create = useMutation({ mutationFn: () => quotesApi.create(projectId), onSuccess: (q) => navigate(`/quotes/${q.id}`) });

  if (list.isError) return <LoadError error={list.error} notFound={t('quotes.notFound')} forbidden={t('quotes.forbidden')} back={{ to: '/projects', label: coreT('projects.back') }} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('quotes.title')}</h1>
        <Link to="/quotes/settings" className="text-sm underline">
          {t('quotes.settingsLink')}
        </Link>
      </div>
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (projectId) create.mutate();
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="quote-project">{t('quotes.project')}</Label>
              <Select id="quote-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">–</option>
                {projects.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.client ? ` (${p.client.name})` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={!projectId || create.isPending}>
              + {create.isPending ? t('quotes.creating') : t('quotes.new')}
            </Button>
          </form>
          {create.error && <p role="alert" className="mt-2 text-sm text-destructive">{create.error.message}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('quotes.list')}</h2>
        </CardHeader>
        <CardContent className="p-0">
          {list.isPending && <p className="px-4 pb-4">{coreT('common.loading')}</p>}
          {list.data?.items.length === 0 && <p className="px-4 pb-4 text-muted-foreground">{t('quotes.empty')}</p>}
          {list.data && <QuoteList items={list.data.items} timeZone={tz} withProject />}
        </CardContent>
      </Card>
    </div>
  );
}
