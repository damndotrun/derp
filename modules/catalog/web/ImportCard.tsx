import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fill } from '@/core/i18n.ts';
import { cn } from '@/lib/utils';
import { formatFiller } from '../shared/format.ts';
import type { ImportField, ImportPreview, ImportRequest, ImportRow } from '../shared/schemas.ts';
import { catalogApi, catalogKey, fileToImport } from './api.ts';
import { t } from './i18n.ts';

const SAMPLE =
  '﻿Cikkszám;Megnevezés;Egység;Nettó egységár;ÁFA-kulcs;Beszállító\r\n' +
  'VENT-125;Csőventilátor Ø125 mm;db;48 500;27;Légtechnika Nagyker Kft.\r\n' +
  'BIL-125;Csőbilincs Ø125 mm, gumibetétes;db;412,50;27;Légtechnika Nagyker Kft.\r\n';

const STATUS_CLASS: Record<ImportRow['status'], string> = {
  new: 'bg-emerald-100 text-emerald-900',
  changed: 'bg-amber-100 text-amber-900',
  unchanged: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ status }: { status: ImportRow['status'] }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[status])}>
      {t(`catalog.import.status.${status}`)}
    </span>
  );
}

/** Az előnézet: összesítés, a hibás sorok okkal, utánuk a többi sor (a módosuló mezők kiemelve). */
export function ImportPreviewView({ preview, fileName }: { preview: ImportPreview; fileName: string }) {
  if (preview.fileError) return <p className="text-sm text-destructive" role="alert">{preview.fileError}</p>;
  const s = preview.summary;
  const delimiter = preview.delimiter === '\t' ? t('catalog.import.tab') : preview.delimiter;
  const cell = (row: ImportRow, f: ImportField) => cn('p-2', row.status === 'changed' && row.changed.includes(f) && 'font-semibold text-amber-900');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{fill(t('catalog.import.fileInfo'), { name: fileName, encoding: preview.encoding, delimiter })}</p>
      <ul aria-label={t('catalog.import.summary')} className="flex flex-wrap gap-2 text-sm">
        {(['new', 'changed', 'unchanged', 'error'] as const).map((k) => (
          <li key={k} className={cn('rounded-full px-3 py-1', STATUS_CLASS[k])}>
            {fill(t(`catalog.import.summary.${k}`), { count: s[k] })}
          </li>
        ))}
      </ul>
      {s.error > 0 && <p className="text-sm text-destructive">{t('catalog.import.errorsSkipped')}</p>}
      <div className="overflow-x-auto">
        <table aria-label={t('catalog.import.preview')} className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="p-2 font-medium">{t('catalog.import.line')}</th>
              <th scope="col" className="p-2 font-medium">{t('catalog.import.status')}</th>
              <th scope="col" className="p-2 font-medium">{t('catalog.field.sku')}</th>
              <th scope="col" className="p-2 font-medium">{t('catalog.field.name')}</th>
              <th scope="col" className="p-2 font-medium">{t('catalog.field.unit')}</th>
              <th scope="col" className="p-2 text-right font-medium">{t('catalog.field.netUnitPriceFiller')}</th>
              <th scope="col" className="p-2 text-right font-medium">{t('catalog.field.vatRate')}</th>
              <th scope="col" className="p-2 font-medium">{t('catalog.field.supplier')}</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) =>
              row.status === 'error' ? (
                <tr key={row.line} className="border-b bg-destructive/5 align-top">
                  <td className="p-2 tabular-nums">{row.line}</td>
                  <td className="p-2"><StatusBadge status="error" /></td>
                  <td colSpan={6} className="p-2">
                    <ul className="text-destructive">
                      {row.errors.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                    <p className="break-all font-mono text-xs text-muted-foreground">{row.raw.join(' | ')}</p>
                  </td>
                </tr>
              ) : (
                <tr key={row.line} className="border-b align-top">
                  <td className="p-2 tabular-nums">{row.line}</td>
                  <td className="p-2"><StatusBadge status={row.status} /></td>
                  <td className="p-2 font-mono text-xs">{row.values.sku}</td>
                  <td className={cell(row, 'name')}>{row.values.name}</td>
                  <td className={cell(row, 'unit')}>{row.values.unit}</td>
                  <td className={cn(cell(row, 'netUnitPriceFiller'), 'whitespace-nowrap text-right tabular-nums')}>
                    {formatFiller(row.values.netUnitPriceFiller)}
                  </td>
                  <td className={cn(cell(row, 'vatRate'), 'text-right tabular-nums')}>{row.values.vatRate}%</td>
                  <td className={cell(row, 'supplier')}>{row.values.supplier}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {preview.omitted > 0 && <p className="text-xs text-muted-foreground">{fill(t('catalog.import.omitted'), { count: preview.omitted })}</p>}
    </div>
  );
}

/** CSV-import: fájl kiválasztása → előnézet (semmi nem íródik) → „Importálás”. Csak `catalog.manage` jogosultsággal. */
export function ImportCard() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<ImportRequest | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string>();
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([SAMPLE], { type: 'text/csv;charset=utf-8' }));
    setSampleUrl(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  const preview = useMutation({ mutationFn: catalogApi.preview });
  const commit = useMutation({
    mutationFn: catalogApi.import,
    onSuccess: ({ summary }) => {
      setDone(fill(t('catalog.import.done'), { new: summary.new, changed: summary.changed }));
      reset();
      void queryClient.invalidateQueries({ queryKey: catalogKey });
    },
  });

  function reset() {
    setFile(null);
    preview.reset();
    setInputKey((k) => k + 1);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setDone(null);
    commit.reset();
    if (!f) return reset();
    const body = await fileToImport(f);
    setFile(body);
    preview.mutate(body);
  }

  const s = preview.data?.summary;
  const importable = s ? s.new + s.changed : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.import.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('catalog.import.intro')}</p>
        {sampleUrl && (
          <a href={sampleUrl} download="cikktorzs-minta.csv" className="text-sm underline underline-offset-2">
            {t('catalog.import.sample')}
          </a>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="catalog-import-file">{t('catalog.import.file')}</Label>
          <Input key={inputKey} id="catalog-import-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e)} />
        </div>
        {done && <p className="text-sm text-emerald-700" role="status">{done}</p>}
        {preview.isPending && <p className="text-sm">{t('catalog.import.reading')}</p>}
        {preview.isError && <p className="text-sm text-destructive" role="alert">{preview.error.message}</p>}
        {preview.data && file && <ImportPreviewView preview={preview.data} fileName={file.fileName ?? ''} />}
        {preview.data && !preview.data.fileError && importable === 0 && (
          <p className="text-sm text-muted-foreground">{t('catalog.import.nothing')}</p>
        )}
        {commit.isError && <p className="text-sm text-destructive" role="alert">{commit.error.message}</p>}
        {preview.data && file && (
          <div className="flex flex-wrap gap-2">
            {importable > 0 && (
              <Button disabled={commit.isPending} onClick={() => commit.mutate(file)}>
                {fill(t('catalog.import.submit'), { count: importable })}
              </Button>
            )}
            <Button variant="outline" disabled={commit.isPending} onClick={reset}>
              {t('catalog.import.cancel')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
