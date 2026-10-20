import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from './api.ts';
import { t } from './i18n.ts';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name, clientName });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('projects.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('projects.new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">{t('projects.name')}</Label>
              <Input id="project-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-client">{t('projects.client')}</Label>
              <Input id="project-client" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {t('projects.create')}
            </Button>
          </form>
          {create.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {create.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 sm:p-0">
          {projects.isPending && <p className="p-4">{t('common.loading')}</p>}
          {projects.isError && <p className="p-4 text-destructive">{projects.error.message}</p>}
          {projects.data?.items.length === 0 && <p className="p-4 text-muted-foreground">{t('projects.empty')}</p>}
          <ul aria-label={t('projects.title')} className="divide-y">
            {projects.data?.items.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="flex flex-col px-4 py-3 hover:bg-accent">
                  <span className="font-medium">{p.name}</span>
                  {p.clientName && <span className="text-sm text-muted-foreground">{p.clientName}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
