import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';
import type { ThreadSummary } from '../shared.ts';
import { useGmailPermission } from './api.ts';
import { t } from './i18n.ts';

/** Bájtméret emberi alakban (pl. „179 kB”). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** A `Név <cím>` alakú fejlécből a név (ha van), különben a cím. */
export function displayName(header: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(header);
  if (!m) return header.trim();
  return m[1]!.trim() || m[2]!.trim();
}

const STATUS_TONE: Record<ThreadSummary['status'], string> = {
  order: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  client_rfq_reply_needed: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  quote_processing: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  quote_received: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  client_rfq_open: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  rfq_sent: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  discussion: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
};

export function StatusBadge({ status }: { status: ThreadSummary['status'] }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[status])}>{t(`gmail.status.${status}`)}</span>;
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground', className)}>{children}</span>;
}

/** A levelek oldalai (a menüben egy „Levelek” pont van). */
export function GmailNav() {
  const rules = useGmailPermission('gmail.rules');
  const accounts = useGmailPermission('gmail.accounts');
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-md px-3 py-1.5 text-sm', isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent');
  return (
    <nav aria-label={t('gmail.pages')} className="flex flex-wrap gap-1">
      <NavLink to="/gmail" end className={link}>
        {t('gmail.inbox.title')}
      </NavLink>
      {rules && (
        <NavLink to="/gmail/rules" className={link}>
          {t('gmail.rules.title')}
        </NavLink>
      )}
      {accounts && (
        <NavLink to="/gmail/accounts" className={link}>
          {t('gmail.accounts.title')}
        </NavLink>
      )}
    </nav>
  );
}
