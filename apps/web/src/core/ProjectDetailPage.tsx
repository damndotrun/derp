import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Project } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from './api.ts';
import { EventList } from './EventList.tsx';
import { formatDateTime } from './format.ts';
import { t } from './i18n.ts';
import { useSession } from './session.ts';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const session = useSession();
  const tz = session.data?.tzDisplay ?? 'Europe/Budapest';
  const project = useQuery({ queryKey: ['projects', id], queryFn: () => api.project(id), retry: false });
  const events = useQuery({
    queryKey: ['projects', id, 'events'],
    queryFn: () => api.projectEvents(id),
    enabled: project.isSuccess,
  });
  const [editing, setEditing] = useState(false);

  if (project.isPending) return <p>{t('common.loading')}</p>;
  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="flex flex-col gap-2">
        <p className={notFound ? '' : 'text-destructive'}>{notFound ? t('projects.notFound') : project.error.message}</p>
        <Link to="/projects" className="text-sm underline">
          {t('projects.back')}
        </Link>
      </div>
    );
  }

  const p = project.data;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/projects" className="text-sm text-muted-foreground hover:underline">
        ← {t('projects.back')}
      </Link>
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="text-sm text-muted-foreground">
            {p.clientName && <>{p.clientName} · </>}
            {t('projects.createdAt')}: {formatDateTime(p.createdAt, tz)}
          </p>
        </CardHeader>
        <CardContent>
          {editing ? <EditForm project={p} onDone={() => setEditing(false)} /> : <Actions project={p} onEdit={() => setEditing(true)} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('events.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isPending && <p>{t('common.loading')}</p>}
          {events.isError && <p className="text-destructive">{events.error.message}</p>}
          {events.data && <EventList events={events.data.items} timeZone={tz} />}
        </CardContent>
      </Card>
    </div>
  );
}

function Actions({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects', { replace: true });
    },
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={onEdit}>
        {t('projects.edit')}
      </Button>
      <Button
        variant="destructive"
        disabled={remove.isPending}
        onClick={() => window.confirm(t('projects.deleteConfirm')) && remove.mutate()}
      >
        {t('projects.delete')}
      </Button>
      {remove.error && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}
    </div>
  );
}

function EditForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName);
  const save = useMutation({
    mutationFn: () => api.updateProject(project.id, { version: project.version, name, clientName }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">{t('projects.name')}</Label>
        <Input id="edit-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-client">{t('projects.client')}</Label>
        <Input id="edit-client" value={clientName} onChange={(e) => setClientName(e.target.value)} />
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {t('projects.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('projects.cancel')}
        </Button>
      </div>
    </form>
  );
}
