import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/core/format.ts';
import { fill } from '@/core/i18n.ts';
import { useSession } from '@/core/session.ts';
import { visitsApi, visitsKey } from './api.ts';
import { t } from './i18n.ts';

/** A saját ICS-feed linkje. A szerver csak a token hash-ét tárolja, ezért a link csak elkészítéskor látszik. */
export function IcsCard() {
  const queryClient = useQueryClient();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const key = [...visitsKey, 'ics-token'];
  const info = useQuery({ queryKey: key, queryFn: visitsApi.icsToken });
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: visitsApi.createIcsToken,
    onSuccess: async () => {
      setCopied(false);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const copy = async (url: string) => {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('visits.ics.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('visits.ics.intro')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {info.data && !create.data && (
          <p className="text-sm">
            {info.data.exists && info.data.createdAt
              ? fill(t('visits.ics.exists'), { date: formatDateTime(info.data.createdAt, tz) })
              : t('visits.ics.none')}
          </p>
        )}
        {create.data && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visits-ics-url">{t('visits.ics.url')}</Label>
            <div className="flex gap-2">
              <Input id="visits-ics-url" readOnly value={create.data.url} onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" onClick={() => void copy(create.data.url)}>
                {t('visits.ics.copy')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{copied ? t('visits.ics.copied') : t('visits.ics.onlyOnce')}</p>
          </div>
        )}
        <div>
          <Button variant="outline" disabled={create.isPending || info.isPending} onClick={() => create.mutate()}>
            {info.data?.exists || create.data ? t('visits.ics.regenerate') : t('visits.ics.create')}
          </Button>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
