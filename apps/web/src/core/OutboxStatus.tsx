import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateTime } from './format.ts';
import { fill, t } from './i18n.ts';
import { useOnline } from './offline.ts';
import { outbox, useOutbox, type OutboxItem } from './outbox.ts';

/** A felhasználó sora: a várakozó és a sikertelen elemek (az épp most küldött nem). */
export function useOutboxStatus(userId: string | null) {
  const snapshot = useOutbox();
  const mine = snapshot.items.filter((i) => userId === null || i.userId === userId);
  return {
    ...snapshot,
    waiting: mine.filter((i) => i.state === 'waiting'),
    failed: mine.filter((i) => i.state === 'failed'),
  };
}

/**
 * Sorállapot-jelzés a felület tetején: nincs kapcsolat, „N elem vár feltöltésre”, sikertelen elemek (újra / elvetés),
 * és ha belépés kell (lejárt munkamenet vagy Cloudflare Access), a belépés. Ha minden fent van és van hálózat, semmi.
 */
export function OutboxStatus({ userId, timeZone }: { userId: string; timeZone: string }) {
  const online = useOnline();
  const { waiting, failed, authRequired, syncing } = useOutboxStatus(userId);
  const [open, setOpen] = useState(false);
  const items = [...waiting, ...failed].sort((a, b) => a.seq! - b.seq!);

  if (online && items.length === 0 && !authRequired) return null;

  return (
    <section
      aria-label={t('offline.region')}
      aria-live="polite"
      className={cn(
        'mb-4 flex flex-col gap-2 rounded-md border px-3 py-2 text-sm',
        items.length > 0 || authRequired ? 'border-amber-300 bg-amber-50 text-amber-950' : 'bg-muted text-muted-foreground',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!online && <strong className="font-semibold">{t('offline.offline')}</strong>}
        {waiting.length > 0 && <span className="font-medium">{fill(t('offline.pending'), { n: waiting.length })}</span>}
        {failed.length > 0 && <span className="font-medium text-destructive">{fill(t('offline.failed'), { n: failed.length })}</span>}
        {syncing && online && <span>{t('offline.syncing')}</span>}
        <span className="ml-auto flex gap-2">
          {online && !syncing && waiting.length > 0 && !authRequired && (
            <Button size="sm" variant="outline" onClick={() => void outbox.run()}>
              {t('offline.syncNow')}
            </Button>
          )}
          {items.length > 0 && (
            <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? t('offline.hideDetails') : t('offline.details')}
            </Button>
          )}
        </span>
      </div>
      {!online && <p>{t('offline.offlineHint')}</p>}
      {authRequired && (
        <p className="flex flex-wrap items-center gap-2">
          <span>{t(authRequired === 'access' ? 'offline.authAccess' : 'offline.authSession')}</span>
          {authRequired === 'access' ? (
            <Button size="sm" onClick={() => window.location.reload()}>
              {t('offline.reload')}
            </Button>
          ) : (
            <Link to="/login" className="font-medium underline">
              {t('offline.login')}
            </Link>
          )}
        </p>
      )}
      {open && items.length > 0 && (
        <>
          <ul aria-label={t('offline.items')} className="flex flex-col gap-1">
            {items.map((i) => (
              <ItemRow key={i.seq} item={i} timeZone={timeZone} />
            ))}
          </ul>
          <p className="text-xs">{t('offline.unsyncedWarning')}</p>
        </>
      )}
    </section>
  );
}

function ItemRow({ item, timeZone }: { item: OutboxItem; timeZone: string }) {
  const failed = item.state === 'failed';
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <time dateTime={item.createdAt} className="text-xs">
        {formatDateTime(item.createdAt, timeZone)}
      </time>
      <span className={cn('text-xs', failed && 'text-destructive')}>
        {failed ? `${t('offline.stateFailed')}: ${item.error ?? ''}` : t('offline.stateWaiting')}
      </span>
      {failed && (
        <>
          <Button size="sm" variant="outline" onClick={() => void outbox.retry(item.seq!)}>
            {t('offline.retry')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(t('offline.discardConfirm'))) void outbox.discard(item.seq!);
            }}
          >
            {t('offline.discard')}
          </Button>
        </>
      )}
    </li>
  );
}

/** A belépő oldalon: ha ezen az eszközön elemek várnak, belépés után feltöltődnek. */
export function OutboxLoginNotice() {
  const { items } = useOutbox();
  if (items.length === 0) return null;
  return (
    <p aria-live="polite" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      {fill(t('offline.loginNotice'), { n: items.length })}
    </p>
  );
}
