import { Link } from 'react-router';
import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';
import type { NoteEventData, SurveyEventData } from '../shared.ts';
import { t } from './i18n.ts';

const surveyData = (data: Record<string, unknown>): SurveyEventData | null =>
  typeof data.surveyId === 'string' && typeof data.condition === 'string' && Array.isArray(data.materials)
    ? (data as unknown as SurveyEventData)
    : null;

const noteData = (data: Record<string, unknown>): NoteEventData | null =>
  typeof data.noteId === 'string' && typeof data.body === 'string' ? (data as unknown as NoteEventData) : null;

/**
 * „Felmérés” az idővonalon: az észlelt állapot, a javasolt munka és az anyagtételek száma, link a felmérésre. A fotók
 * alatta, a `docs` eseményeiként (a felmérés eseményére mutató `parentId`-vel).
 */
export function SurveyAddedEvent(props: EventRendererProps) {
  const s = surveyData(props.event.data);
  const projectId = props.event.projectId;
  if (!s) return <DefaultEvent {...props} />;
  return (
    <DefaultEvent {...props}>
      <dl className="mt-1 text-sm">
        <dt className="inline text-muted-foreground">{t('notes.condition')}: </dt>
        <dd className="inline whitespace-pre-wrap break-words">{s.condition}</dd>
        <br />
        <dt className="inline text-muted-foreground">{t('notes.proposedWork')}: </dt>
        <dd className="inline whitespace-pre-wrap break-words">{s.proposedWork}</dd>
      </dl>
      <p className="mt-1 text-sm">
        <span className="text-muted-foreground">
          {s.materials.length} {t('notes.materialCount')} · {s.photos} {t('notes.photoCount')} ·{' '}
        </span>
        {projectId && (
          <Link to={`/notes/${projectId}/surveys/${s.surveyId}`} className="underline">
            {t('notes.openSurvey')}
          </Link>
        )}
      </p>
    </DefaultEvent>
  );
}

/** „Helyszíni jegyzet” az idővonalon: a szöveg (hosszú jegyzetnél levágva). */
export function NoteAddedEvent(props: EventRendererProps) {
  const n = noteData(props.event.data);
  if (!n) return <DefaultEvent {...props} />;
  return (
    <DefaultEvent {...props}>
      <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-sm">{n.body}</p>
    </DefaultEvent>
  );
}
