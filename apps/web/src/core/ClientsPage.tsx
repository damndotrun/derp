import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from './api.ts';
import { clientsKey } from './ClientSelect.tsx';
import { t } from './i18n.ts';

export function ClientsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useQuery({ queryKey: clientsKey, queryFn: api.clients });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const create = useMutation({
    mutationFn: api.createClient,
    onSuccess: async (client) => {
      await queryClient.invalidateQueries({ queryKey: clientsKey });
      navigate(`/clients/${client.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name, address });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('clients.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('clients.new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-name">{t('clients.name')}</Label>
              <Input id="client-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-address">{t('clients.address')}</Label>
              <Input id="client-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {t('clients.create')}
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
          {clients.isPending && <p className="p-4">{t('common.loading')}</p>}
          {clients.isError && <p className="p-4 text-destructive">{clients.error.message}</p>}
          {clients.data?.items.length === 0 && <p className="p-4 text-muted-foreground">{t('clients.empty')}</p>}
          <ul aria-label={t('clients.title')} className="divide-y">
            {clients.data?.items.map((c) => (
              <li key={c.id}>
                <Link to={`/clients/${c.id}`} className="flex flex-col px-4 py-3 hover:bg-accent">
                  <span className="font-medium">{c.name}</span>
                  {c.address && <span className="text-sm text-muted-foreground">{c.address}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
