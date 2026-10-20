import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { api } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useModules } from '@/core/modules.ts';
import { usePendingItems, type OutboxItem } from '@/core/outbox.ts';
import { useSession } from '@/core/session.ts';
import { useLiveEvents } from '@/core/stream.ts';
import type { Note, Survey } from '../shared.ts';
import { notesApi, notesKey } from './api.ts';
import { NOTES_OUTBOX, NoteForm, SurveyForm } from './Forms.tsx';
import { t } from './i18n.ts';
import type { PreparedNote, PreparedSurvey } from './save.ts';
import { NoteCard, SurveyCard } from './SurveyView.tsx';

type Item = { kind: 'survey'; at: string; survey: Survey } | { kind: 'note'; at: string; note: Note };

/** Egy projekt jegyzetei és felmérései (élőben frissül), új jegyzet és felmérés felvétele. */
export function ProjectNotesPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const canWrite = useModules().data?.items.find((m) => m.id === 'notes')?.permissions.includes('notes.write') ?? false;
  const [open, setOpen] = useState<'survey' | 'note' | null>(null);

  const project = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.project(projectId), retry: false });
  const notes = useQuery({ queryKey: notesKey(projectId), queryFn: () => notesApi.project(projectId), enabled: project.isSuccess });
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: notesKey(projectId) }), [queryClient, projectId]);
  // Az offline sorban váró saját felmérések és jegyzetek (még nincsenek a szerveren).
  const queuedSurveys = usePendingItems(NOTES_OUTBOX.survey, projectId);
  const queuedNotes = usePendingItems(NOTES_OUTBOX.note, projectId);
  const saved = new Set([...(notes.data?.surveys ?? []).map((x) => x.id), ...(notes.data?.notes ?? []).map((x) => x.id)]);
  const queued = [...queuedSurveys, ...queuedNotes].filter((i) => !saved.has(i.id)).sort((a, b) => b.seq! - a.seq!);
  // Új jegyzet, felmérés és a fotók feltöltése (más felhasználótól vagy más lapról) újratöltés nélkül megjelenik.
  useLiveEvents((e) => {
    if (e.projectId === projectId && (e.type.startsWith('notes.') || e.type.startsWith('docs.'))) void refresh();
  });

  if (project.isPending) return <p>{coreT('common.loading')}</p>;
  if (project.isError) {
    return (
      <LoadError
        error={project.error}
        notFound={t('notes.notFound')}
        forbidden={t('notes.forbidden')}
        back={{ to: '/notes', label: t('notes.backToList') }}
      />
    );
  }

  const items: Item[] = [
    ...(notes.data?.surveys ?? []).map((survey): Item => ({ kind: 'survey', at: survey.createdAt, survey })),
    ...(notes.data?.notes ?? []).map((note): Item => ({ kind: 'note', at: note.createdAt, note })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const onSaved = () => {
    setOpen(null);
    void refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
            ← {t('notes.backToProject')}
          </Link>
          <h1 className="text-2xl font-semibold">{t('notes.title')}</h1>
          <p className="truncate text-muted-foreground">{project.data.name}</p>
        </div>
        <Link to={`/docs/${projectId}`} className="text-sm underline">
          {t('notes.openDocs')}
        </Link>
      </div>

      {canWrite && open === null && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setOpen('survey')}>+ {t('notes.newSurvey')}</Button>
          <Button variant="outline" onClick={() => setOpen('note')}>
            + {t('notes.newNote')}
          </Button>
        </div>
      )}
      {open === 'survey' && <SurveyForm projectId={projectId} onSaved={onSaved} onCancel={() => setOpen(null)} />}
      {open === 'note' && <NoteForm projectId={projectId} onSaved={onSaved} onCancel={() => setOpen(null)} />}

      {queued.length > 0 && (
        <ul aria-label={t('notes.queuedItems')} className="flex flex-col gap-3">
          {queued.map((i) => (
            <li key={i.id}>
              <QueuedCard item={i} timeZone={tz} />
            </li>
          ))}
        </ul>
      )}

      {notes.isPending && <p>{coreT('common.loading')}</p>}
      {notes.isError && <p className="text-destructive">{notes.error.message}</p>}
      {notes.isSuccess && items.length === 0 && queued.length === 0 && <p className="text-muted-foreground">{t('notes.empty')}</p>}
      <ul aria-label={t('notes.items')} className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.kind === 'survey' ? i.survey.id : i.note.id}>
            {i.kind === 'survey' ? <SurveyCard survey={i.survey} timeZone={tz} link /> : <NoteCard note={i.note} timeZone={tz} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Az offline sorban váró felmérés vagy jegyzet: a fő adatok és „feltöltésre vár” (vagy a hiba). */
function QueuedCard({ item, timeZone }: { item: OutboxItem; timeZone: string }) {
  const survey = item.kind === NOTES_OUTBOX.survey ? (item.payload as PreparedSurvey) : null;
  const note = survey ? null : (item.payload as PreparedNote);
  const at = (survey ?? note)?.capturedAt ?? item.createdAt;
  const failed = item.state === 'failed';
  return (
    <article aria-label={`${item.label} (${t('notes.queued')})`} className="flex flex-col gap-1 rounded-lg border border-dashed bg-card p-4">
      <p className="text-sm text-muted-foreground">
        <time dateTime={at}>{formatDateTime(at, timeZone)}</time> ·{' '}
        <span className={failed ? 'text-destructive' : undefined}>{failed ? `${t('notes.queuedFailed')}: ${item.error ?? ''}` : t('notes.queued')}</span>
      </p>
      {survey ? (
        <>
          <h3 className="font-semibold">
            {t('notes.outboxSurvey')}: {survey.location}
          </h3>
          <p className="whitespace-pre-wrap text-sm">{survey.condition}</p>
          <p className="text-sm text-muted-foreground">
            {survey.materials.length} {t('notes.queuedMaterials')} · {survey.photos.length} {t('notes.queuedPhotos')}
          </p>
        </>
      ) : (
        <p className="whitespace-pre-wrap">{note?.body}</p>
      )}
    </article>
  );
}
