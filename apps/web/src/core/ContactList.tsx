import type { ReactNode } from 'react';
import type { Contact } from '@derp/shared';
import { t } from './i18n.ts';

/** Kapcsolattartók névvel, beosztással, kattintható telefonszámmal és e-mail-címmel. */
export function ContactList({ contacts, actions }: { contacts: Contact[]; actions?: (c: Contact) => ReactNode }) {
  if (contacts.length === 0) return <p className="text-sm text-muted-foreground">{t('contacts.empty')}</p>;
  return (
    <ul aria-label={t('contacts.title')} className="flex flex-col divide-y">
      {contacts.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">
              {c.name}
              {c.position && <span className="font-normal text-muted-foreground"> · {c.position}</span>}
            </span>
            {c.phone && (
              <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-sm underline">
                {c.phone}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="truncate text-sm underline">
                {c.email}
              </a>
            )}
            {c.note && <span className="text-sm text-muted-foreground">{c.note}</span>}
          </div>
          {actions?.(c)}
        </li>
      ))}
    </ul>
  );
}
