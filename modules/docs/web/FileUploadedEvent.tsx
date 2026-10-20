import { Link } from 'react-router';
import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';
import type { DocsFileEventData } from '../shared.ts';
import { fileUrls } from './api.ts';
import { t } from './i18n.ts';

const fileData = (data: Record<string, unknown>): DocsFileEventData | null =>
  typeof data.fileId === 'string' && typeof data.name === 'string' ? (data as unknown as DocsFileEventData) : null;

/**
 * „Fotó/Fájl feltöltve” az idővonalon: bélyegkép (ha van), kattintva a fájl megnyílik; link a dokumentumtár
 * megfelelő mappájára. Ha a fájlt azóta törölték, a bélyegkép helyén csak a név marad.
 */
export function FileUploadedEvent(props: EventRendererProps) {
  const f = fileData(props.event.data);
  const projectId = props.event.projectId;
  if (!f) return <DefaultEvent {...props} />;
  const urls = fileUrls(f.fileId);
  const docsLink = projectId ? `/docs/${projectId}${f.folderId ? `?folder=${f.folderId}` : ''}` : null;
  return (
    <DefaultEvent {...props}>
      <div className="mt-2 flex items-end gap-3">
        {f.thumb && (
          <a href={urls.content} target="_blank" rel="noreferrer" className="block size-20 shrink-0 overflow-hidden rounded-md bg-muted">
            <img
              src={urls.thumb}
              alt={f.name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => ((e.currentTarget.parentElement as HTMLElement).hidden = true)}
            />
          </a>
        )}
        {docsLink && (
          <Link to={docsLink} className="text-sm underline">
            {t('docs.openInDocs')}
          </Link>
        )}
      </div>
    </DefaultEvent>
  );
}
