import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { api, request } from '@/core/api.ts';
import { t } from './i18n.ts';

export function ExamplePage() {
  const greeting = useQuery({
    queryKey: ['example', 'greeting'],
    queryFn: () => request<{ text: string }>('GET', '/api/example/greeting'),
  });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [projectId, setProjectId] = useState('');
  const ping = useMutation({
    mutationFn: (id: string) => request<{ eventId: string }>('POST', `/api/example/projects/${id}/ping`),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (projectId) ping.mutate(projectId);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('example.title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{greeting.data?.text ?? '…'}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('example.intro')}</p>
        </CardHeader>
        <CardContent>
          {projects.data?.items.length === 0 ? (
            <p className="text-muted-foreground">{t('example.noProjects')}</p>
          ) : (
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="example-project">{t('example.project')}</Label>
                <select
                  id="example-project"
                  required
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    ping.reset();
                  }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t('example.chooseProject')}</option>
                  {projects.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={!projectId || ping.isPending}>
                {t('example.send')}
              </Button>
            </form>
          )}
          {ping.isSuccess && (
            <p role="status" className="mt-2 text-sm">
              {t('example.sent')}
            </p>
          )}
          {ping.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {ping.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
