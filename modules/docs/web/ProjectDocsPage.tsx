import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useModules } from '@/core/modules.ts';
import { submit as submitOutbox } from '@/core/outbox.ts';
import { useSession, useUser } from '@/core/session.ts';
import { useLiveEvents } from '@/core/stream.ts';
import type { DocsFile, DocsFolder } from '../shared.ts';
import { docsApi, docsKey, fileUrls } from './api.ts';
import { extensionLabel, formatSize, isImage } from './format.ts';
import { t } from './i18n.ts';
import { prepareUpload } from './upload.ts';

/** Egy projekt dokumentumtára: mappák, feltöltés (több fájl, húzd-és-ejtsd, telefonon kamera), fájlrács bélyegképekkel. */
export function ProjectDocsPage() {
  const { projectId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const folderId = search.get('folder');
  const queryClient = useQueryClient();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const user = useUser();
  const permissions = useModules().data?.items.find((m) => m.id === 'docs')?.permissions ?? [];
  const canUpload = permissions.includes('docs.upload');
  const canManage = permissions.includes('docs.manage');

  const project = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.project(projectId), retry: false });
  const docs = useQuery({ queryKey: docsKey(projectId), queryFn: () => docsApi.project(projectId), enabled: project.isSuccess });
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: docsKey(projectId) }), [queryClient, projectId]);
  // Más felhasználó (vagy más lap) feltöltése, törlése újratöltés nélkül megjelenik.
  useLiveEvents((e) => {
    if (e.projectId === projectId && e.type.startsWith('docs.')) void refresh();
  });
  const [preview, setPreview] = useState<DocsFile | null>(null);

  if (project.isPending) return <p>{coreT('common.loading')}</p>;
  if (project.isError) {
    return (
      <LoadError
        error={project.error}
        notFound={t('docs.notFound')}
        forbidden={t('docs.forbidden')}
        back={{ to: '/docs', label: t('docs.backToList') }}
      />
    );
  }

  const folders = docs.data?.folders ?? [];
  const current = folderId ? folders.find((f) => f.id === folderId) ?? null : null;
  const subfolders = folders.filter((f) => f.parentId === (current?.id ?? null));
  const files = (docs.data?.files ?? []).filter((f) => f.folderId === (current?.id ?? null));
  const openFolder = (id: string | null) => setSearch(id ? { folder: id } : {});
  const canModify = (f: DocsFile) => canManage || (!!user && f.uploadedBy?.id === user.id);

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
        ← {t('docs.backToProject')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{t('docs.title')}</h1>
        <p className="text-muted-foreground">{project.data.name}</p>
      </div>
      <Breadcrumbs folders={folders} current={current} onOpen={openFolder} />

      {canUpload && <UploadPanel projectId={projectId} folderId={current?.id ?? null} onUploaded={refresh} />}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('docs.folders')}</CardTitle>
          {canManage && current && <FolderActions folder={current} onDeleted={() => openFolder(current.parentId)} onChanged={refresh} />}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {subfolders.length > 0 && (
            <ul aria-label={t('docs.folders')} className="flex flex-wrap gap-2">
              {subfolders.map((f) => (
                <li key={f.id}>
                  <Button variant="outline" onClick={() => openFolder(f.id)}>
                    📁 {f.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {canUpload && <NewFolderForm projectId={projectId} parentId={current?.id ?? null} onCreated={refresh} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('docs.files')}</CardTitle>
        </CardHeader>
        <CardContent>
          {docs.isPending && <p>{coreT('common.loading')}</p>}
          {docs.isError && <p className="text-destructive">{docs.error.message}</p>}
          {docs.isSuccess && files.length === 0 && <p className="text-sm text-muted-foreground">{t('docs.empty')}</p>}
          <ul aria-label={t('docs.files')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {files.map((f) => (
              <li key={f.id} className="flex flex-col overflow-hidden rounded-md border">
                <button type="button" onClick={() => setPreview(f)} className="block aspect-square bg-muted" aria-label={`${t('docs.preview')}: ${f.name}`}>
                  <FileThumb file={f} />
                </button>
                <div className="flex flex-col gap-0.5 p-2 text-sm">
                  <span className="truncate font-medium" title={f.name}>
                    {f.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatSize(f.size)} · {formatDateTime(f.createdAt, tz)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {preview && (
        <FilePreview
          file={preview}
          folders={folders}
          timeZone={tz}
          canModify={canModify(preview)}
          onClose={() => setPreview(null)}
          onChanged={async () => {
            setPreview(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

export function FileThumb({ file, className = 'h-full w-full object-cover' }: { file: DocsFile; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (file.hasThumb && !failed) {
    return <img src={fileUrls(file.id).thumb} alt={file.name} loading="lazy" className={className} onError={() => setFailed(true)} />;
  }
  return (
    <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground" aria-hidden>
      {extensionLabel(file.name)}
    </span>
  );
}

function Breadcrumbs({ folders, current, onOpen }: { folders: DocsFolder[]; current: DocsFolder | null; onOpen: (id: string | null) => void }) {
  const path: DocsFolder[] = [];
  for (let f = current; f; f = folders.find((x) => x.id === f!.parentId) ?? null) path.unshift(f);
  return (
    <nav aria-label={t('docs.breadcrumb')} className="flex flex-wrap items-center gap-1 text-sm">
      <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpen(null)} aria-current={current ? undefined : 'page'}>
        {t('docs.root')}
      </button>
      {path.map((f) => (
        <span key={f.id} className="flex items-center gap-1">
          <span aria-hidden>/</span>
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpen(f.id)} aria-current={f.id === current?.id ? 'page' : undefined}>
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

type UploadStatus = 'waiting' | 'uploading' | 'done' | 'queued' | 'error';
interface UploadItem {
  key: number;
  name: string;
  status: UploadStatus;
  error?: string;
}

/**
 * Feltöltés több fájllal, húzd-és-ejtsd-del és telefonon a kamerával. A fájlok egymás után mennek fel (a szerver és a
 * terepi kapcsolat kímélése miatt); a nagy fotókat a böngésző előtte 2560 px-re kicsinyíti. Az offline soron át
 * mennek: hálózat nélkül a telefonon várnak („Feltöltésre vár”), és visszatéréskor maguktól felmennek.
 */
function UploadPanel({ projectId, folderId, onUploaded }: { projectId: string; folderId: string | null; onUploaded: () => Promise<unknown> }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const nextKey = useRef(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const setStatus = (key: number, status: UploadStatus, error?: string) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, status, error } : i)));

  const enqueue = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const added = files.map((file) => ({ key: nextKey.current++, name: file.name, status: 'waiting' as const, file }));
    setItems((prev) => [...prev.filter((i) => i.status !== 'done'), ...added.map(({ file: _f, ...i }) => i)]);
    chain.current = chain.current.then(async () => {
      for (const item of added) {
        setStatus(item.key, 'uploading');
        try {
          const u = await prepareUpload(projectId, item.file, { folderId });
          const label = `${t(isImage(u.type) ? 'docs.outboxPhoto' : 'docs.outboxFile')}: ${u.name}`;
          const outcome = await submitOutbox('docs.upload', u, { id: u.id, projectId, label });
          setStatus(item.key, outcome.status === 'sent' ? 'done' : 'queued');
        } catch (err) {
          setStatus(item.key, 'error', (err as Error).message);
        }
      }
      await onUploaded();
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    enqueue(e.dataTransfer.files);
  };

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={dragging ? 'border-2 border-dashed border-primary' : 'border-2 border-dashed'}
      data-testid="docs-dropzone"
    >
      <CardHeader>
        <CardTitle>{t('docs.upload')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => filesInput.current?.click()}>
            {t('docs.chooseFiles')}
          </Button>
          <Button type="button" variant="outline" onClick={() => cameraInput.current?.click()}>
            {t('docs.takePhoto')}
          </Button>
          <span className="text-sm text-muted-foreground">{dragging ? t('docs.dropActive') : t('docs.dropHint')}</span>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            aria-label={t('docs.chooseFiles')}
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label={t('docs.takePhoto')}
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {items.length > 0 && (
          <ul aria-label={t('docs.queue')} className="flex flex-col gap-1 text-sm">
            {items.map((i) => (
              <li key={i.key} className="flex justify-between gap-2">
                <span className="truncate">{i.name}</span>
                <span role="status" className={i.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                  {t(`docs.status.${i.status}`)}
                  {i.error && `: ${i.error}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NewFolderForm({ projectId, parentId, onCreated }: { projectId: string; parentId: string | null; onCreated: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => docsApi.createFolder(projectId, { name, parentId }),
    onSuccess: async () => {
      setName('');
      await onCreated();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label={t('docs.newFolder')}>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="docs-folder-name">{t('docs.folderName')}</Label>
        <Input id="docs-folder-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </div>
      <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
        {t('docs.createFolder')}
      </Button>
      {create.error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

function FolderActions({ folder, onDeleted, onChanged }: { folder: DocsFolder; onDeleted: () => void; onChanged: () => Promise<unknown> }) {
  const rename = useMutation({
    mutationFn: (name: string) => docsApi.updateFolder(folder.id, { version: folder.version, name }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => docsApi.deleteFolder(folder.id),
    onSuccess: async () => {
      onDeleted();
      await onChanged();
    },
  });
  const error = rename.error ?? remove.error;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const name = window.prompt(t('docs.folderName'), folder.name);
          if (name?.trim() && name !== folder.name) rename.mutate(name.trim());
        }}
      >
        {t('docs.renameFolder')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => window.confirm(t('docs.deleteFolderConfirm')) && remove.mutate()}>
        {t('docs.deleteFolder')}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
}

/** Előnézet: kép nagyban, PDF új lapon; letöltés; a jogosultnak átnevezés, áthelyezés és törlés. */
function FilePreview({
  file,
  folders,
  timeZone,
  canModify,
  onClose,
  onChanged,
}: {
  file: DocsFile;
  folders: DocsFolder[];
  timeZone: string;
  canModify: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const urls = fileUrls(file.id);
  const [name, setName] = useState(file.name);
  const [folderId, setFolderId] = useState(file.folderId ?? '');
  const save = useMutation({
    mutationFn: () =>
      docsApi.updateFile(file.id, {
        version: file.version,
        ...(name !== file.name ? { name } : {}),
        ...((folderId || null) !== file.folderId ? { folderId: folderId || null } : {}),
      }),
    onSuccess: onChanged,
  });
  const remove = useMutation({ mutationFn: () => docsApi.deleteFile(file.id), onSuccess: onChanged });
  const dirty = name.trim() !== file.name || (folderId || null) !== file.folderId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && name.trim()) save.mutate();
  };
  const error = save.error ?? remove.error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
        className="flex max-h-full w-full max-w-4xl flex-col gap-3 overflow-auto rounded-lg bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{file.name}</h2>
            <p className="text-sm text-muted-foreground">
              {formatSize(file.size)} · {formatDateTime(file.createdAt, timeZone)}
              {file.uploadedBy && (
                <>
                  {' '}
                  · {t('docs.uploadedBy')}: {file.uploadedBy.name}
                </>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('docs.close')}
          </Button>
        </div>

        {isImage(file.mime) && file.mime !== 'image/svg+xml' ? (
          <img src={urls.content} alt={file.name} className="max-h-[70vh] w-full rounded-md object-contain" />
        ) : file.mime === 'application/pdf' ? (
          <a href={urls.content} target="_blank" rel="noreferrer" className="underline">
            {t('docs.openPdf')}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">{t('docs.noPreview')}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <a href={urls.download} download={file.name} className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
            {t('docs.download')}
          </a>
          {canModify && (
            <Button variant="destructive" disabled={remove.isPending} onClick={() => window.confirm(t('docs.deleteConfirm')) && remove.mutate()}>
              {t('docs.delete')}
            </Button>
          )}
        </div>

        {canModify && (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="docs-file-name">{t('docs.rename')}</Label>
              <Input id="docs-file-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="docs-file-folder">{t('docs.moveTo')}</Label>
              <Select id="docs-file-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">{t('docs.root')}</option>
                {folderOptions(folders).map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {'  '.repeat(depth)}
                    {folder.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline" disabled={!dirty || !name.trim() || save.isPending}>
              {t('docs.save')}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** A mappák fa-sorrendben, mélységgel (a választóhoz). */
export function folderOptions(folders: DocsFolder[]): Array<{ folder: DocsFolder; depth: number }> {
  const out: Array<{ folder: DocsFolder; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'hu'))) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
