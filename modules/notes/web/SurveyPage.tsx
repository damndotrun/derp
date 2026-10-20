import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useSession } from '@/core/session.ts';
import { useLiveEvents } from '@/core/stream.ts';
import { notesApi, surveyKey } from './api.ts';
import { t } from './i18n.ts';
import { SurveyCard } from './SurveyView.tsx';

/** Egy felmérés saját oldala (pl. az idővonal linkjéről); a fotók állapota élőben frissül. */
export function SurveyPage() {
  const { projectId = '', surveyId = '' } = useParams();
  const queryClient = useQueryClient();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const survey = useQuery({ queryKey: surveyKey(surveyId), queryFn: () => notesApi.survey(surveyId), retry: false });
  useLiveEvents((e) => {
    if (e.projectId === projectId && e.type.startsWith('docs.')) void queryClient.invalidateQueries({ queryKey: surveyKey(surveyId) });
  });

  const back = { to: `/notes/${projectId}`, label: t('notes.backToNotes') };
  if (survey.isPending) return <p>{coreT('common.loading')}</p>;
  if (survey.isError) return <LoadError error={survey.error} notFound={t('notes.surveyNotFound')} forbidden={t('notes.forbidden')} back={back} />;
  return (
    <div className="flex flex-col gap-4">
      <Link to={back.to} className="text-sm text-muted-foreground hover:underline">
        ← {back.label}
      </Link>
      <SurveyCard survey={survey.data} timeZone={tz} />
    </div>
  );
}
