import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatDateTime } from '@/core/format.ts';
import { fileUrls } from '../../docs/web/api.ts';
import type { MaterialItem, Note, Survey, SurveyPhoto } from '../shared.ts';
import { t } from './i18n.ts';

const quantity = (n: number) => new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 3 }).format(n);

/** A becsült anyag tételesen (táblázat). */
export function MaterialsTable({ items }: { items: MaterialItem[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 pr-2 font-normal">{t('notes.material.name')}</th>
          <th className="py-1 pr-2 text-right font-normal">{t('notes.material.quantity')}</th>
          <th className="py-1 font-normal">{t('notes.material.unit')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((m, i) => (
          <tr key={i} className="border-t">
            <td className="py-1 pr-2 break-words">{m.name}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{quantity(m.quantity)}</td>
            <td className="py-1">{m.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Photo({ photo }: { photo: SurveyPhoto }) {
  if (photo.status !== 'ready') {
    return (
      <span className="flex h-24 w-24 flex-col items-center justify-center rounded-md border p-1 text-center text-xs text-muted-foreground">
        <span className="line-clamp-2 break-all">{photo.name}</span>
        <span>{photo.status === 'pending' ? t('notes.photoPending') : t('notes.photoDeleted')}</span>
      </span>
    );
  }
  const urls = fileUrls(photo.id);
  return (
    <a href={urls.content} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-md border bg-muted">
      {photo.hasThumb ? (
        <img src={urls.thumb} alt={photo.name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center p-1 text-center text-xs break-all">{photo.name}</span>
      )}
    </a>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

/** Egy felmérés minden mezője és a fotói. Ha `link`, a cím a felmérés saját oldalára mutat. */
export function SurveyCard({ survey, timeZone, link }: { survey: Survey; timeZone: string; link?: boolean }) {
  const title = `${t('notes.survey')}: ${survey.location}`;
  return (
    <article aria-label={title} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header>
        <h2 className="text-lg font-semibold break-words">
          {link ? (
            <Link to={`/notes/${survey.projectId}/surveys/${survey.id}`} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          <time dateTime={survey.createdAt}>{formatDateTime(survey.createdAt, timeZone)}</time> · {survey.author.name}
        </p>
      </header>
      <dl className="flex flex-col gap-2">
        <Field label={t('notes.location')}>{survey.location}</Field>
        <Field label={t('notes.condition')}>{survey.condition}</Field>
        <Field label={t('notes.proposedWork')}>{survey.proposedWork}</Field>
      </dl>
      <section aria-label={t('notes.materials')}>
        <h3 className="text-sm text-muted-foreground">{t('notes.materials')}</h3>
        <MaterialsTable items={survey.materials} />
      </section>
      <section aria-label={t('notes.photos')}>
        <h3 className="text-sm text-muted-foreground">{t('notes.photos')}</h3>
        {survey.photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('notes.noPhotos')}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {survey.photos.map((p) => (
              <li key={p.id}>
                <Photo photo={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function NoteCard({ note, timeZone }: { note: Note; timeZone: string }) {
  return (
    <article aria-label={`${t('notes.note')}: ${note.body.slice(0, 80)}`} className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{t('notes.note')}</h2>
      <p className="text-sm text-muted-foreground">
        <time dateTime={note.createdAt}>{formatDateTime(note.createdAt, timeZone)}</time> · {note.author.name}
      </p>
      <p className="whitespace-pre-wrap break-words">{note.body}</p>
    </article>
  );
}
