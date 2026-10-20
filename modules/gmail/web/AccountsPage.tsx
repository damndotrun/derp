import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/core/format.ts';
import { fill } from '@/core/i18n.ts';
import { RoleGate } from '@/core/RoleGate.tsx';
import { useSession } from '@/core/session.ts';
import { accountsKey, gmailApi, gmailKey } from './api.ts';
import { t } from './i18n.ts';
import { GmailNav } from './parts.tsx';

/** A bekötött fiókok (admin). Mock-forrásnál a felvétel a beépített postafiókot tölti be. */
export function AccountsPage() {
  return (
    <RoleGate roles={['admin']}>
      <Accounts />
    </RoleGate>
  );
}

function Accounts() {
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: accountsKey, queryFn: gmailApi.accounts });
  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: () => gmailApi.addAccount(email),
    onSuccess: () => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: gmailKey });
    },
  });
  const mock = accounts.data?.source === 'mock';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('gmail.title')}</h1>
      <GmailNav />
      <Card>
        <CardHeader>
          <CardTitle>{t('gmail.accounts.title')}</CardTitle>
          {accounts.data && <p className="text-sm text-muted-foreground">{mock ? t('gmail.accounts.mockNote') : t('gmail.accounts.liveNote')}</p>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mock && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <div className="flex min-w-56 flex-1 flex-col gap-1 sm:max-w-md">
                <Label htmlFor="gmail-account-email">{t('gmail.accounts.email')}</Label>
                <Input id="gmail-account-email" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" disabled={add.isPending}>
                {t('gmail.accounts.add')}
              </Button>
            </form>
          )}
          {add.isError && <p className="text-sm text-destructive">{add.error.message}</p>}
          {accounts.isError && <p className="text-sm text-destructive">{accounts.error.message}</p>}
          {accounts.data && accounts.data.items.length === 0 && <p className="text-sm text-muted-foreground">{t('gmail.accounts.empty')}</p>}
          {accounts.data && accounts.data.items.length > 0 && (
            <ul className="flex flex-col divide-y">
              {accounts.data.items.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 py-2">
                  <span className="font-medium">{a.email}</span>
                  <span className="text-sm text-muted-foreground">
                    {a.source} · {fill(t('gmail.accounts.messages'), { n: a.messageCount })} · {t('gmail.accounts.lastSync')}:{' '}
                    {a.lastSyncAt ? formatDateTime(a.lastSyncAt, tz) : t('gmail.accounts.never')}
                  </span>
                  {a.lastSyncError && (
                    <span className="text-sm text-destructive">
                      {t('gmail.accounts.error')}: {a.lastSyncError}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
