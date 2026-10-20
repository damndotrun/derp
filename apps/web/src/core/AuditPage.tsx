import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { AuditAction, type AuditEntry } from '@derp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from './api.ts';
import { formatDateTime } from './format.ts';
import { t, translate } from './i18n.ts';
import { useSession } from './session.ts';

const CORE_ENTITIES = ['project', 'client', 'contact', 'user'] as const;

/** A mag entitásainak neve; a modulokéi (`<modul>.<entitás>`) a modul i18n-kulcsából (`<modul>.audit.<entitás>`). */
function entityLabel(type: string): string {
  if ((CORE_ENTITIES as readonly string[]).includes(type)) return translate(`audit.entity.${type}`);
  const [moduleId, entity] = type.split('.');
  const key = `${moduleId}.audit.${entity}`;
  const text = translate(key);
  return text === key ? type : text;
}

function EntityCell({ e }: { e: AuditEntry }) {
  const text = `${entityLabel(e.entityType)}: ${e.label || e.entityId}`;
  if (e.action !== 'delete' && e.entityType === 'project') return <Link to={`/projects/${e.entityId}`} className="underline">{text}</Link>;
  if (e.action !== 'delete' && e.entityType === 'client') return <Link to={`/clients/${e.entityId}`} className="underline">{text}</Link>;
  return <>{text}</>;
}

/** Adminfelület: ki, mikor, mit nézett meg vagy módosított. */
export function AuditPage() {
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const users = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [userId, setUserId] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const filter = { userId: userId || undefined, entityType: entityType || undefined, action: (action || undefined) as AuditAction | undefined };
  const entries = useInfiniteQuery({
    queryKey: ['audit', filter],
    queryFn: ({ pageParam }) => api.audit({ ...filter, before: pageParam ?? undefined }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = entries.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('audit.title')}</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-user">{t('audit.user')}</Label>
          <Select id="audit-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-entity">{t('audit.entity')}</Label>
          <Select id="audit-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {CORE_ENTITIES.map((type) => (
              <option key={type} value={type}>
                {entityLabel(type)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">{t('audit.action')}</Label>
          <Select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {AuditAction.options.map((a) => (
              <option key={a} value={a}>
                {t(`audit.action.${a}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 sm:p-0">
          {entries.isPending && <p className="p-4">{t('common.loading')}</p>}
          {entries.isError && <p className="p-4 text-destructive">{entries.error.message}</p>}
          {entries.isSuccess && items.length === 0 && <p className="p-4 text-muted-foreground">{t('audit.empty')}</p>}
          <ul aria-label={t('audit.title')} className="divide-y">
            {items.map((e) => (
              <li key={e.id} className="grid gap-x-4 px-4 py-2 text-sm sm:grid-cols-[11rem_10rem_8rem_1fr]">
                <time dateTime={e.at} className="text-muted-foreground">
                  {formatDateTime(e.at, tz)}
                </time>
                <span>{e.user?.name ?? '–'}</span>
                <span className="font-medium">{t(`audit.action.${e.action}`)}</span>
                <span className="min-w-0 break-words">
                  <EntityCell e={e} />
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {entries.hasNextPage && (
        <Button variant="outline" className="self-start" disabled={entries.isFetchingNextPage} onClick={() => entries.fetchNextPage()}>
          {t('audit.more')}
        </Button>
      )}
    </div>
  );
}
