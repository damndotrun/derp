import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';
import type { WatchFileEventData } from '../shared.ts';
import { fileUrl } from './api.ts';
import { formatSize } from './format.ts';
import { t } from './i18n.ts';

const fileData = (data: Record<string, unknown>): WatchFileEventData | null =>
  typeof data.fileId === 'string' && typeof data.path === 'string' && typeof data.size === 'number'
    ? (data as unknown as WatchFileEventData)
    : null;

/**
 * A szerver-mappa fájlváltozásai az idővonalon: az útvonal a hozzárendelt mappán belül, a méret, átnevezésnél a
 * korábbi útvonal, és (a törlés kivételével) letöltés-link.
 */
export function WatchFileEvent(props: EventRendererProps) {
  const f = fileData(props.event.data);
  if (!f) return <DefaultEvent {...props} />;
  const deleted = props.event.type === 'watch.file_deleted';
  return (
    <DefaultEvent {...props}>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="break-all">{f.path}</span>
        <span className="text-muted-foreground">{formatSize(f.size)}</span>
        {!deleted && (
          <a href={fileUrl(f.fileId)} download={f.name} className="underline">
            {t('watch.download')}
          </a>
        )}
      </p>
      {f.oldPath && (
        <p className="text-sm text-muted-foreground">
          {t('watch.oldPath')}: <span className="break-all">{f.oldPath}</span>
        </p>
      )}
    </DefaultEvent>
  );
}
