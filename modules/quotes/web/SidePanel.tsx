import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fill, t as coreT } from '@/core/i18n.ts';
import { useLiveEvents } from '@/core/stream.ts';
import { Timeline } from '@/core/Timeline.tsx';
import { cn } from '@/lib/utils';
import { docsApi, docsKey, fileUrls } from '../../docs/web/api.ts';
import { FileThumb } from '../../docs/web/ProjectDocsPage.tsx';
import type { MaterialItem } from '../../notes/shared.ts';
import { notesApi, notesKey } from '../../notes/web/api.ts';
import { SurveyCard } from '../../notes/web/SurveyView.tsx';
import { formatQuantity } from '../shared/format.ts';
import { t } from './i18n.ts';

type Tab = 'surveys' | 'photos' | 'timeline';
const TABS: Tab[] = ['surveys', 'photos', 'timeline'];

/**
 * Az ajánlatszerkesztő mellett a projekt felmérései (a becsült anyag tételei kézi tételként vagy cikkereséssel
 * vehetők át), fotói (a dokumentumtárból) és idővonala. Élőben frissül.
 */
export function SidePanel({
  projectId,
  timeZone,
  onMaterial,
  onSearch,
  canTakeOver,
}: {
  projectId: string;
  timeZone: string;
  /** Az anyagtétel kézi tételként az ajánlatba. */
  onMaterial: (m: MaterialItem) => void;
  /** Keresés a cikktörzsben az anyagtétel nevével. */
  onSearch: (m: MaterialItem) => void;
  /** Csak tervezetbe lehet tételt átvenni. */
  canTakeOver: boolean;
}) {
  const [tab, setTab] = useState<Tab>('surveys');
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: notesKey(projectId), queryFn: () => notesApi.project(projectId) });
  const docs = useQuery({ queryKey: docsKey(projectId), queryFn: () => docsApi.project(projectId) });
  // Új felmérés vagy fotó (pl. a terepről) újratöltés nélkül megjelenik.
  useLiveEvents((e) => {
    if (e.projectId !== projectId) return;
    if (e.type.startsWith('notes.')) void queryClient.invalidateQueries({ queryKey: notesKey(projectId) });
    if (e.type.startsWith('docs.')) {
      void queryClient.invalidateQueries({ queryKey: docsKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: notesKey(projectId) });
    }
  });

  const photos = (docs.data?.files ?? []).filter((f) => f.mime.startsWith('image/'));
  const surveys = notes.data?.surveys ?? [];
  const label: Record<Tab, string> = {
    surveys: `${t('quotes.panel.surveys')} (${surveys.length})`,
    photos: `${t('quotes.panel.photos')} (${photos.length})`,
    timeline: t('quotes.panel.timeline'),
  };

  return (
    <aside aria-label={t('quotes.panel')} className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label={t('quotes.panel')} className="flex flex-wrap gap-1 rounded-md border p-1">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`quote-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`quote-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn('flex-1 rounded px-2 py-1.5 text-sm font-medium', tab === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
          >
            {label[id]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`quote-panel-${tab}`} aria-labelledby={`quote-tab-${tab}`} className="flex min-w-0 flex-col gap-3">
        {tab === 'surveys' && (
          <>
            {notes.isPending && <p>{coreT('common.loading')}</p>}
            {notes.isError && <p className="text-destructive">{notes.error.message}</p>}
            {notes.isSuccess && surveys.length === 0 && <p className="text-sm text-muted-foreground">{t('quotes.panel.noSurveys')}</p>}
            {surveys.map((s) => (
              <div key={s.id} className="flex flex-col gap-2">
                <SurveyCard survey={s} timeZone={timeZone} link />
                {canTakeOver && (
                  <section aria-label={`${t('quotes.panel.takeOver')}: ${s.location}`} className="rounded-lg border border-dashed p-3">
                    <h3 className="mb-1 text-sm font-medium">{t('quotes.panel.takeOver')}</h3>
                    <ul className="flex flex-col gap-2">
                      {s.materials.map((m, i) => {
                        const name = fill(t('quotes.panel.material'), { name: m.name, quantity: formatQuantity(m.quantity), unit: m.unit });
                        return (
                          <li key={i} className="flex flex-wrap items-center justify-between gap-1">
                            <span className="min-w-0 text-sm break-words">{name}</span>
                            <span className="flex gap-1">
                              <Button type="button" size="sm" variant="outline" aria-label={`${t('quotes.panel.asManual')}: ${m.name}`} onClick={() => onMaterial(m)}>
                                + {t('quotes.panel.asManualShort')}
                              </Button>
                              <Button type="button" size="sm" variant="outline" aria-label={`${t('quotes.panel.searchCatalog')}: ${m.name}`} onClick={() => onSearch(m)}>
                                {t('quotes.panel.searchShort')}
                              </Button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'photos' && (
          <>
            {docs.isPending && <p>{coreT('common.loading')}</p>}
            {docs.isError && <p className="text-destructive">{docs.error.message}</p>}
            {docs.isSuccess && photos.length === 0 && <p className="text-sm text-muted-foreground">{t('quotes.panel.noPhotos')}</p>}
            <ul aria-label={t('quotes.panel.photos')} className="grid grid-cols-3 gap-2">
              {photos.map((f) => (
                <li key={f.id}>
                  <a href={fileUrls(f.id).content} target="_blank" rel="noreferrer" title={f.name} className="block aspect-square overflow-hidden rounded-md border bg-muted">
                    <FileThumb file={f} />
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'timeline' && <Timeline projectId={projectId} timeZone={timeZone} />}
      </div>
    </aside>
  );
}
