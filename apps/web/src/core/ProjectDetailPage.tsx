import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Project } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from './api.ts';
import { ClientSelect } from './ClientSelect.tsx';
import { ContactList } from './ContactList.tsx';
import { EventList } from './EventList.tsx';
import { formatDateTime } from './format.ts';
import { t } from './i18n.ts';
import { LoadError } from './LoadError.tsx';
import { isOffice, useSession, useUser } from './session.ts';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const session = useSession();
  const user = useUser();
  const office = isOffice(user);
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
    return (
      <LoadError
        error={project.error}
        notFound={t('projects.notFound')}
        forbidden={t('projects.forbidden')}
        back={{ to: '/projects', label: t('projects.back') }}
      />
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
            {p.client && (
              <>
                {office ? (
                  <Link to={`/clients/${p.client.id}`} className="underline">
                    {p.client.name}
                  </Link>
                ) : (
                  p.client.name
                )}{' '}
                ·{' '}
              </>
            )}
            {t('projects.createdAt')}: {formatDateTime(p.createdAt, tz)}
          </p>
        </CardHeader>
        {office && (
          <CardContent>
            {editing ? <EditForm project={p} onDone={() => setEditing(false)} /> : <Actions project={p} onEdit={() => setEditing(true)} />}
          </CardContent>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {p.client && <ClientContacts clientId={p.client.id} />}
        <Members projectId={p.id} canEdit={office} />
      </div>
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

/** Az ügyfél kapcsolattartói (a terepes is látja a hozzá rendelt projekt ügyfelének elérhetőségét). */
function ClientContacts({ clientId }: { clientId: string }) {
  const client = useQuery({ queryKey: ['clients', clientId], queryFn: () => api.client(clientId) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('projects.contacts')}</CardTitle>
      </CardHeader>
      <CardContent>
        {client.isPending && <p>{t('common.loading')}</p>}
        {client.isError && <p className="text-destructive">{client.error.message}</p>}
        {client.data && (
          <div className="flex flex-col gap-2">
            {client.data.address && <p className="text-sm">{client.data.address}</p>}
            <ContactList contacts={client.data.contacts} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Members({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const key = ['projects', projectId, 'members'];
  const members = useQuery({ queryKey: key, queryFn: () => api.projectMembers(projectId) });
  const users = useQuery({ queryKey: ['users'], queryFn: api.users, enabled: canEdit });
  const [userId, setUserId] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: (uid: string) => api.addMember(projectId, uid),
    onSuccess: async () => {
      setUserId('');
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: (uid: string) => api.removeMember(projectId, uid), onSuccess: refresh });

  const memberIds = new Set(members.data?.items.map((m) => m.id));
  const candidates = (users.data?.items ?? []).filter((u) => u.active && !memberIds.has(u.id));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (userId) add.mutate(userId);
  };
  const error = add.error ?? remove.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('projects.members')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {members.isPending && <p>{t('common.loading')}</p>}
        {members.data?.items.length === 0 && <p className="text-sm text-muted-foreground">{t('projects.membersEmpty')}</p>}
        <ul aria-label={t('projects.members')} className="flex flex-col gap-1">
          {members.data?.items.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span>
                {m.name} <span className="text-sm text-muted-foreground">({t(`role.${m.role}`)})</span>
              </span>
              {canEdit && (
                <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(m.id)}>
                  {t('projects.unassign')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="member-user">{t('projects.addMember')}</Label>
              <Select id="member-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">–</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({t(`role.${u.role}`)})
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline" disabled={!userId || add.isPending}>
              {t('projects.assign')}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
      </CardContent>
    </Card>
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
  const [clientId, setClientId] = useState(project.client?.id ?? '');
  const save = useMutation({
    mutationFn: () => api.updateProject(project.id, { version: project.version, name, clientId: clientId || null }),
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
        <ClientSelect id="edit-client" value={clientId} onChange={setClientId} />
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
