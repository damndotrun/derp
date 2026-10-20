import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useModules } from '@/core/modules.ts';
import { useSession } from '@/core/session.ts';
import { useLiveEvents } from '@/core/stream.ts';
import type { ProjectWatch, ScanResult, WatchFile } from '../shared.ts';
import { fileUrl, mappingsKey, watchApi, watchKey } from './api.ts';
import { fill, formatSize } from './format.ts';
import { t } from './i18n.ts';

/** Ennyi fájl látszik egyszerre a listában (nagy mappánál a szűrővel lehet szűkíteni). */
export const FILE_LIST_LIMIT = 500;

/**
 * Egy projekt szerver-mappája: a hozzárendelt almappa (az iroda választja ki a figyelt gyökérből), „Most ellenőrizd”,
 * a mappa fájljai letöltéssel. A változások eseményként a projekt idővonalán jelennek meg; ez az oldal élőben frissül.
 */
export function ProjectWatchPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const permissions = useModules().data?.items.find((m) => m.id === 'watch')?.permissions ?? [];
  const canManage = permissions.includes('watch.manage');
  const canScan = permissions.includes('watch.scan');
  const [picking, setPicking] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const project = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.project(projectId), retry: false });
  const watch = useQuery({ queryKey: watchKey(projectId), queryFn: () => watchApi.project(projectId), enabled: project.isSuccess });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: watchKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: mappingsKey });
  }, [queryClient, projectId]);
  // Az ütemezett (vagy más által indított) bejárás változásai újratöltés nélkül megjelennek.
  useLiveEvents((e) => {
    if (e.projectId === projectId && e.type.startsWith('watch.')) refresh();
  });
  const updated = (data: ProjectWatch | void) => {
    if (data) queryClient.setQueryData(watchKey(projectId), data);
    refresh();
  };

  const scan = useMutation({
    mutationFn: () => watchApi.scan(projectId),
    onSuccess: (res) => {
      setScanResult(res);
      refresh();
    },
  });
  const unassign = useMutation({
    mutationFn: () => watchApi.deleteMapping(projectId),
    onSuccess: () => {
      setScanResult(null);
      updated({ mapping: null, files: [] });
    },
  });

  if (project.isPending) return <p>{coreT('common.loading')}</p>;
  if (project.isError) {
    return (
      <LoadError
        error={project.error}
        notFound={t('watch.notFound')}
        forbidden={t('watch.forbidden')}
        back={{ to: '/watch', label: t('watch.backToList') }}
      />
    );
  }

  const mapping = watch.data?.mapping ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
        ← {t('watch.backToProject')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{t('watch.title')}</h1>
        <p className="text-muted-foreground">{project.data.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('watch.mapping')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {watch.isPending && <p>{coreT('common.loading')}</p>}
          {watch.isError && <p className="text-destructive">{watch.error.message}</p>}
          {watch.isSuccess && !mapping && (
            <p className="text-muted-foreground">{canManage ? t('watch.mappingNone') : t('watch.mappingNoneReadOnly')}</p>
          )}
          {mapping && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('watch.mapping')}</dt>
              <dd className="break-all font-medium" data-testid="watch-mapping-path">
                {mapping.path}
              </dd>
              <dt className="text-muted-foreground">{t('watch.lastScan')}</dt>
              <dd>{mapping.lastScanAt ? formatDateTime(mapping.lastScanAt, tz) : t('watch.neverScanned')}</dd>
            </dl>
          )}
          {mapping?.lastError && (
            <p role="alert" className="text-sm text-destructive">
              {t('watch.scanError')}: {mapping.lastError}
            </p>
          )}
          {scanResult && !scanResult.error && (
            <p role="status" className="text-sm">
              {fill(t('watch.scanResult'), { added: scanResult.added, modified: scanResult.modified, deleted: scanResult.deleted, renamed: scanResult.renamed })}
            </p>
          )}
          {scan.isError && <p className="text-sm text-destructive">{scan.error.message}</p>}
          {unassign.isError && <p className="text-sm text-destructive">{unassign.error.message}</p>}

          {!picking && (
            <div className="flex flex-wrap gap-2">
              {mapping && canScan && (
                <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
                  {scan.isPending ? t('watch.scanning') : t('watch.scanNow')}
                </Button>
              )}
              {canManage && watch.isSuccess && (
                <Button variant="outline" onClick={() => setPicking(true)}>
                  {mapping ? t('watch.change') : t('watch.assign')}
                </Button>
              )}
              {canManage && mapping && (
                <Button
                  variant="ghost"
                  disabled={unassign.isPending}
                  onClick={() => {
                    if (window.confirm(t('watch.unassignConfirm'))) unassign.mutate();
                  }}
                >
                  {t('watch.unassign')}
                </Button>
              )}
            </div>
          )}
          {picking && (
            <FolderPicker
              projectId={projectId}
              initialPath={mapping ? parentOf(mapping.path) : ''}
              version={mapping?.version}
              onAssigned={(data) => {
                setPicking(false);
                setScanResult(null);
                updated(data);
              }}
              onCancel={() => setPicking(false)}
            />
          )}
        </CardContent>
      </Card>

      {mapping && <FileList files={watch.data?.files ?? []} timeZone={tz} />}
    </div>
  );
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** A figyelt gyökér böngészése: almappák megnyitása, majd az aktuális mappa hozzárendelése. */
function FolderPicker({
  projectId,
  initialPath,
  version,
  onAssigned,
  onCancel,
}: {
  projectId: string;
  initialPath: string;
  version: number | undefined;
  onAssigned: (data: ProjectWatch) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState(initialPath);
  const folders = useQuery({ queryKey: ['watch', 'folders', path], queryFn: () => watchApi.folders(path), retry: false });
  const assign = useMutation({ mutationFn: () => watchApi.setMapping(projectId, { path, version }), onSuccess: onAssigned });
  const segments = path ? path.split('/') : [];
  const current = folders.data?.folders;

  return (
    <section aria-label={t('watch.picker')} className="flex flex-col gap-3 rounded-md border p-3">
      <h2 className="font-medium">{t('watch.picker')}</h2>
      <nav aria-label={t('watch.pickerPath')} className="flex flex-wrap items-center gap-1 text-sm">
        <Button variant="ghost" size="sm" aria-current={path === '' ? 'page' : undefined} onClick={() => setPath('')}>
          {t('watch.pickerRoot')}
        </Button>
        {segments.map((s, i) => {
          const to = segments.slice(0, i + 1).join('/');
          return (
            <span key={to} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <Button variant="ghost" size="sm" aria-current={to === path ? 'page' : undefined} onClick={() => setPath(to)}>
                {s}
              </Button>
            </span>
          );
        })}
      </nav>
      {folders.isPending && <p className="text-sm">{coreT('common.loading')}</p>}
      {folders.isError && <p className="text-sm text-destructive">{folders.error.message}</p>}
      {current && current.length === 0 && <p className="text-sm text-muted-foreground">{t('watch.pickerEmpty')}</p>}
      {current && current.length > 0 && (
        <ul aria-label={t('watch.pickerFolders')} className="flex max-h-72 flex-col overflow-y-auto rounded-md border">
          {current.map((f) => (
            <li key={f.path} className="border-b last:border-b-0">
              <button type="button" className="flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left hover:bg-accent" onClick={() => setPath(f.path)}>
                <span>📁 {f.name}</span>
                {f.project && f.project.id !== projectId && (
                  <span className="text-xs text-muted-foreground">
                    ({t('watch.pickerTaken')}: {f.project.name})
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        {path ? (
          <>
            <span className="text-muted-foreground">{t('watch.pickerCurrent')}: </span>
            <span className="break-all font-medium">{path}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t('watch.pickerRootHint')}</span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{t('watch.baselineHint')}</p>
      {assign.isError && <p className="text-sm text-destructive">{assign.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => assign.mutate()} disabled={!path || assign.isPending || folders.isError}>
          {t('watch.pickerChoose')}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t('watch.cancel')}
        </Button>
      </div>
    </section>
  );
}

/** A mappa fájljai útvonal szerint, szűrővel; nagy mappánál az első {@link FILE_LIST_LIMIT} látszik. */
export function FileList({ files, timeZone }: { files: WatchFile[]; timeZone: string }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLocaleLowerCase('hu');
  const matching = needle ? files.filter((f) => f.path.toLocaleLowerCase('hu').includes(needle)) : files;
  const shown = matching.slice(0, FILE_LIST_LIMIT);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          {t('watch.files')} ({files.length})
        </CardTitle>
        {files.length > 0 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="watch-filter" className="sr-only">
              {t('watch.filter')}
            </Label>
            <Input id="watch-filter" placeholder={t('watch.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" />
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {files.length === 0 && <p className="px-4 pb-4 text-muted-foreground">{t('watch.filesEmpty')}</p>}
        {matching.length > shown.length && (
          <p className="px-4 pb-2 text-sm text-muted-foreground">{fill(t('watch.filterLimited'), { shown: shown.length, total: matching.length })}</p>
        )}
        <ul aria-label={t('watch.files')} className="divide-y">
          {shown.map((f) => {
            const name = f.path.slice(f.path.lastIndexOf('/') + 1);
            return (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2">
                <span className="min-w-0 break-all">{f.path}</span>
                <span className="flex items-baseline gap-3 text-sm text-muted-foreground">
                  <span>{formatSize(f.size)}</span>
                  <time dateTime={f.mtime} title={t('watch.modifiedAt')}>
                    {formatDateTime(f.mtime, timeZone)}
                  </time>
                  <a href={fileUrl(f.id)} download={name} className="text-foreground underline" aria-label={`${t('watch.download')}: ${f.path}`}>
                    {t('watch.download')}
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
