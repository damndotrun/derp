import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ClientDetail, Contact } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from './api.ts';
import { clientsKey } from './ClientSelect.tsx';
import { ContactList } from './ContactList.tsx';
import { t } from './i18n.ts';
import { LoadError } from './LoadError.tsx';

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const client = useQuery({ queryKey: ['clients', id], queryFn: () => api.client(id), retry: false });
  const [editing, setEditing] = useState(false);

  if (client.isPending) return <p>{t('common.loading')}</p>;
  if (client.isError) {
    return (
      <LoadError
        error={client.error}
        notFound={t('clients.notFound')}
        forbidden={t('clients.forbidden')}
        back={{ to: '/clients', label: t('clients.back') }}
      />
    );
  }

  const c = client.data;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/clients" className="text-sm text-muted-foreground hover:underline">
        ← {t('clients.back')}
      </Link>
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          {c.address && <p className="text-sm text-muted-foreground">{c.address}</p>}
          {c.note && <p className="text-sm whitespace-pre-line">{c.note}</p>}
        </CardHeader>
        <CardContent>
          {editing ? <ClientForm client={c} onDone={() => setEditing(false)} /> : <ClientActions client={c} onEdit={() => setEditing(true)} />}
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Contacts client={c} />
        <ClientProjects clientId={c.id} />
      </div>
    </div>
  );
}

function ClientActions({ client, onEdit }: { client: ClientDetail; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api.deleteClient(client.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientsKey });
      navigate('/clients', { replace: true });
    },
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={onEdit}>
        {t('common.edit')}
      </Button>
      <Button
        variant="destructive"
        disabled={remove.isPending}
        onClick={() => window.confirm(t('clients.deleteConfirm')) && remove.mutate()}
      >
        {t('common.delete')}
      </Button>
      {remove.error && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}
    </div>
  );
}

function ClientForm({ client, onDone }: { client: ClientDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(client.name);
  const [address, setAddress] = useState(client.address);
  const [note, setNote] = useState(client.note);
  const save = useMutation({
    mutationFn: () => api.updateClient(client.id, { version: client.version, name, address, note }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientsKey });
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
        <Label htmlFor="edit-client-name">{t('clients.name')}</Label>
        <Input id="edit-client-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-client-address">{t('clients.address')}</Label>
        <Input id="edit-client-address" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="edit-client-note">{t('clients.note')}</Label>
        <Textarea id="edit-client-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Contacts({ client }: { client: ClientDetail }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['clients', client.id] });
  const remove = useMutation({ mutationFn: api.deleteContact, onSuccess: refresh });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('contacts.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ContactList
          contacts={client.contacts.filter((c) => c.id !== editing)}
          actions={(c) => (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(c.id)}>
                {t('common.edit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={remove.isPending}
                onClick={() => window.confirm(t('contacts.deleteConfirm')) && remove.mutate(c.id)}
              >
                {t('common.delete')}
              </Button>
            </div>
          )}
        />
        {editing && (
          <ContactForm
            clientId={client.id}
            contact={client.contacts.find((c) => c.id === editing)}
            onDone={() => setEditing(null)}
          />
        )}
        {!editing && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <h3 className="font-medium">{t('contacts.new')}</h3>
            <ContactForm clientId={client.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Új kapcsolattartó, vagy egy meglévő szerkesztése (`contact`). */
function ContactForm({ clientId, contact, onDone }: { clientId: string; contact?: Contact; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const empty = { name: '', position: '', phone: '', email: '', note: '' };
  const [fields, setFields] = useState(contact ? { ...empty, ...contact } : empty);
  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = { name: fields.name, position: fields.position, phone: fields.phone, email: fields.email, note: fields.note };
      return contact ? api.updateContact(contact.id, { version: contact.version, ...body }) : api.createContact(clientId, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients', clientId] });
      if (!contact) setFields(empty);
      onDone?.();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const prefix = contact ? `contact-${contact.id}` : 'contact-new';
  const field = (key: keyof typeof empty, type = 'text', required = false) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${prefix}-${key}`}>{t(`contacts.${key}`)}</Label>
      <Input id={`${prefix}-${key}`} type={type} required={required} value={fields[key]} onChange={set(key)} />
    </div>
  );
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      {field('name', 'text', true)}
      {field('position')}
      {field('phone', 'tel')}
      {field('email', 'email')}
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${prefix}-note`}>{t('contacts.note')}</Label>
        <Textarea id={`${prefix}-note`} value={fields.note} onChange={set('note')} />
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
          {contact ? t('common.save') : t('contacts.create')}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

function ClientProjects({ clientId }: { clientId: string }) {
  const projects = useQuery({ queryKey: ['projects', { clientId }], queryFn: () => api.clientProjects(clientId) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clients.projects')}</CardTitle>
      </CardHeader>
      <CardContent>
        {projects.isPending && <p>{t('common.loading')}</p>}
        {projects.data?.items.length === 0 && <p className="text-sm text-muted-foreground">{t('clients.noProjects')}</p>}
        <ul className="flex flex-col gap-1">
          {projects.data?.items.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className="underline">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
