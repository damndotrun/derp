import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Role, type UserRecord } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from './api.ts';
import { t } from './i18n.ts';
import { useUser } from './session.ts';

const usersKey = ['users'] as const;

/** Adminfelület: felhasználók felvétele, szerepkör és állapot. */
export function UsersPage() {
  const users = useQuery({ queryKey: usersKey, queryFn: api.users });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('users.title')}</h1>
      <NewUser />
      <Card>
        <CardContent className="p-0 sm:p-0">
          {users.isPending && <p className="p-4">{t('common.loading')}</p>}
          {users.isError && <p className="p-4 text-destructive">{users.error.message}</p>}
          <ul aria-label={t('users.title')} className="divide-y">
            {users.data?.items.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function NewUser() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('terepes');
  const create = useMutation({
    mutationFn: api.createUser,
    onSuccess: async () => {
      setEmail('');
      setName('');
      await queryClient.invalidateQueries({ queryKey: usersKey });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ email, name, role });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.new')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('users.hint')}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} aria-label={t('users.new')} className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-email">{t('users.email')}</Label>
            <Input id="user-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-name">{t('users.name')}</Label>
            <Input id="user-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-role">{t('users.role')}</Label>
            <RoleSelect id="user-role" value={role} onChange={setRole} />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {t('users.create')}
          </Button>
        </form>
        {create.error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RoleSelect({ id, value, onChange, disabled }: { id: string; value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(Role.parse(e.target.value))}>
      {Role.options.map((r) => (
        <option key={r} value={r}>
          {t(`role.${r}`)}
        </option>
      ))}
    </Select>
  );
}

function UserRow({ user }: { user: UserRecord }) {
  const queryClient = useQueryClient();
  const me = useUser();
  const self = me?.id === user.id;
  const update = useMutation({
    mutationFn: (body: { role?: Role; active?: boolean }) => api.updateUser(user.id, { version: user.version, ...body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label={user.name}>
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">
          {user.name}
          {!user.active && <span className="font-normal text-muted-foreground"> · {t('users.inactive')}</span>}
        </span>
        <span className="truncate text-sm text-muted-foreground">{user.email}</span>
        {update.error && (
          <span role="alert" className="text-sm text-destructive">
            {update.error.message}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`role-${user.id}`} className="sr-only">
          {t('users.role')}
        </Label>
        <RoleSelect
          id={`role-${user.id}`}
          value={user.role}
          disabled={self || update.isPending}
          onChange={(role) => update.mutate({ role })}
        />
        {!self && (
          <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate({ active: !user.active })}>
            {user.active ? t('users.deactivate') : t('users.activate')}
          </Button>
        )}
      </div>
    </li>
  );
}
