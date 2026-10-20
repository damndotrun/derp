import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/core/api.ts';
import { formatDateTime } from '@/core/format.ts';
import { fill, t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { useSession } from '@/core/session.ts';
import type { MaterialItem } from '../../notes/shared.ts';
import { formatFiller, quoteRef } from '../shared/format.ts';
import { QUOTE_STATUSES, type Quote, type QuoteStatus, type QuoteVersion } from '../shared/schemas.ts';
import { downloadPdf, pdfUrl, projectQuotesKey, quoteKey, quotesApi, quotesKey } from './api.ts';
import { catalogRow, draftTotals, isDirty, manualRow, parseRow, toDraft, toUpdate, type Draft, type Row, type RowField } from './editor.ts';
import { t } from './i18n.ts';
import { ItemPicker } from './ItemPicker.tsx';
import { LinesEditor, LinesView } from './Lines.tsx';
import { SidePanel } from './SidePanel.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Totals } from './Totals.tsx';

const FIELD_LABEL: Record<RowField, Parameters<typeof t>[0]> = {
  name: 'quotes.item.name',
  unit: 'quotes.item.unit',
  quantity: 'quotes.item.quantity',
  price: 'quotes.item.price',
  discount: 'quotes.item.discount',
};

/** Egy ajánlat: verzióválasztó, a tervezet szerkesztője (vagy a lezárt verzió), státusz, PDF-ek, mellette az oldalpanel. */
export function QuotePage() {
  const { quoteId = '' } = useParams();
  const tz = useSession().data?.tzDisplay ?? 'Europe/Budapest';
  const queryClient = useQueryClient();
  const quote = useQuery({ queryKey: quoteKey(quoteId), queryFn: () => quotesApi.quote(quoteId), retry: false });
  const [versionId, setVersionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Az oldalpanelből kézi tételként átvett anyag a szerkesztőbe (a szerkesztő állapota ott van).
  const [incoming, setIncoming] = useState<Row[]>([]);

  if (quote.isPending) return <p>{coreT('common.loading')}</p>;
  if (quote.isError) {
    return <LoadError error={quote.error} notFound={t('quotes.notFound')} forbidden={t('quotes.forbidden')} back={{ to: '/quotes', label: t('quotes.backToList') }} />;
  }

  const q = quote.data;
  const version = q.versions.find((v) => v.id === versionId) ?? q.versions[q.versions.length - 1]!;
  const latest = q.versions[q.versions.length - 1]!;
  const isDraft = version.status === 'tervezet';

  const updated = (next: Quote) => {
    queryClient.setQueryData(quoteKey(q.id), next);
    void queryClient.invalidateQueries({ queryKey: quotesKey, predicate: (query) => query.queryKey[1] !== 'quote' });
    void queryClient.invalidateQueries({ queryKey: projectQuotesKey(q.projectId) });
  };

  const takeOver = (m: MaterialItem) => setIncoming((rows) => [...rows, manualRow({ name: m.name, quantity: m.quantity, unit: m.unit })]);
  const searchFor = (m: MaterialItem) => {
    setSearch(m.name);
    searchRef.current?.focus();
    searchRef.current?.scrollIntoView({ block: 'center' });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <Link to={`/quotes/projects/${q.projectId}`} className="text-sm text-muted-foreground hover:underline">
          ← {t('quotes.backToProjectQuotes')}
        </Link>
        <h1 className="text-2xl font-semibold">{fill(t('quotes.quoteTitle'), { ref: quoteRef(q.number, version.versionNo) })}</h1>
        <p className="text-muted-foreground">
          <Link to={`/projects/${q.projectId}`} className="hover:underline">
            {q.projectName}
          </Link>
          {q.clientName && ` · ${q.clientName}`}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="quote-version">{t('quotes.version')}</Label>
                  <Select id="quote-version" value={version.id} onChange={(e) => setVersionId(e.target.value)} className="w-auto">
                    {q.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {fill(t('quotes.versionOption'), { n: v.versionNo, status: t(`quotes.status.${v.status}`) })}
                      </option>
                    ))}
                  </Select>
                </div>
                <StatusBadge status={version.status} />
                {latest.status !== 'tervezet' && version.id === latest.id && <NewVersionButton quote={q} onDone={(next) => { updated(next); setVersionId(null); }} />}
              </div>
              {!isDraft && <p className="text-sm text-muted-foreground">{t('quotes.newVersionHint')}</p>}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {isDraft ? (
                <DraftEditor
                  key={version.id}
                  quote={q}
                  version={version}
                  search={search}
                  onSearch={setSearch}
                  searchRef={searchRef}
                  incoming={incoming}
                  onIncomingTaken={() => setIncoming([])}
                  onSaved={updated}
                />
              ) : (
                <ClosedVersion version={version} />
              )}
            </CardContent>
          </Card>
          <StatusCard key={`${version.id}:${version.revision}`} version={version} onDone={updated} />
          <PdfList version={version} timeZone={tz} />
        </div>
        <SidePanel projectId={q.projectId} timeZone={tz} onMaterial={takeOver} onSearch={searchFor} canTakeOver={isDraft} />
      </div>
    </div>
  );
}

function NewVersionButton({ quote, onDone }: { quote: Quote; onDone: (q: Quote) => void }) {
  const create = useMutation({ mutationFn: () => quotesApi.newVersion(quote.id), onSuccess: onDone });
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" disabled={create.isPending} onClick={() => create.mutate()}>
        + {t('quotes.newVersion')}
      </Button>
      {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
    </div>
  );
}

function ClosedVersion({ version }: { version: QuoteVersion }) {
  return (
    <>
      <p className="text-sm">{t('quotes.readOnly')}</p>
      <LinesView items={version.items} totals={version.totals} />
      {version.validUntil && (
        <p className="text-sm">
          {t('quotes.validUntil')}: <time dateTime={version.validUntil}>{version.validUntil.replaceAll('-', '. ')}.</time>
        </p>
      )}
      {version.note && (
        <div>
          <h3 className="text-sm text-muted-foreground">{t('quotes.note')}</h3>
          <p className="whitespace-pre-wrap break-words">{version.note}</p>
        </div>
      )}
      <Totals totals={version.totals} />
    </>
  );
}

/** A tervezet szerkesztője: tételek (cikktörzsből vagy kézzel), megjegyzés, érvényesség, élő összesítő, mentés, PDF. */
function DraftEditor({
  quote,
  version,
  search,
  onSearch,
  searchRef,
  incoming,
  onIncomingTaken,
  onSaved,
}: {
  quote: Quote;
  version: QuoteVersion;
  search: string;
  onSearch: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  incoming: Row[];
  onIncomingTaken: () => void;
  onSaved: (q: Quote) => void;
}) {
  const saved = useMemo(() => toDraft(version), [version]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [revision, setRevision] = useState(version.revision);
  const [message, setMessage] = useState<string | null>(null);

  // Mentés után (vagy ha a szerveren frissebb állapot jött) a szerkesztő a mentett állapotra áll.
  useEffect(() => {
    if (version.revision !== revision) {
      setDraft(toDraft(version));
      setRevision(version.revision);
    }
  }, [version, revision]);

  useEffect(() => {
    if (incoming.length === 0) return;
    setDraft((d) => ({ ...d, rows: [...d.rows, ...incoming] }));
    onIncomingTaken();
  }, [incoming, onIncomingTaken]);

  const totals = draftTotals(draft.rows);
  const dirty = isDirty(draft, saved);
  const invalid = [...new Set(draft.rows.flatMap((r) => parseRow(r).errors))];

  const save = useMutation({
    mutationFn: async () => {
      const body = toUpdate(draft, version.revision);
      if (!body) throw new Error(fill(t('quotes.item.invalid'), { fields: invalid.map((f) => t(FIELD_LABEL[f])).join(', ') }));
      return quotesApi.save(version.id, body);
    },
    onSuccess: (q) => {
      onSaved(q);
      setMessage(t('quotes.saved'));
    },
  });

  const pdf = useMutation({
    mutationFn: async () => {
      let rev = version.revision;
      if (dirty) {
        const q = await save.mutateAsync();
        rev = q.versions.find((v) => v.id === version.id)!.revision;
      }
      return quotesApi.pdf(version.id, rev);
    },
    onSuccess: async (file) => {
      downloadPdf(file);
      setMessage(fill(t('quotes.pdfReady'), { name: file.fileName }));
      onSaved(await quotesApi.quote(quote.id));
    },
  });

  const patchRow = (id: string, patch: Partial<Row>) => {
    setMessage(null);
    setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  };
  const removeRow = (id: string) => setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== id) }));
  const moveRow = (id: string, delta: -1 | 1) =>
    setDraft((d) => {
      const rows = [...d.rows];
      const i = rows.findIndex((r) => r.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= rows.length) return d;
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
      return { ...d, rows };
    });
  const addRow = (row: Row) => {
    setMessage(null);
    setDraft((d) => ({ ...d, rows: [...d.rows, row] }));
  };

  const error = save.error ?? pdf.error;
  const stale = error instanceof ApiError && error.status === 409;

  return (
    <form
      aria-label={t('quotes.items')}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <LinesEditor rows={draft.rows} totals={totals} onChange={patchRow} onRemove={removeRow} onMove={moveRow} />
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <ItemPicker
          query={search}
          onQuery={onSearch}
          inputRef={searchRef}
          onPick={(c) => {
            addRow(catalogRow(c));
            onSearch('');
          }}
        />
        <div>
          <Button type="button" variant="outline" onClick={() => addRow(manualRow())}>
            + {t('quotes.addManual')}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-note">{t('quotes.note')}</Label>
          <Textarea id="quote-note" rows={3} value={draft.note} maxLength={4000} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quote-valid">{t('quotes.validUntil')}</Label>
          <Input id="quote-valid" type="date" value={draft.validUntil} onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value }))} />
        </div>
      </div>
      <Totals totals={totals} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!dirty || save.isPending || pdf.isPending}>
          {save.isPending ? t('quotes.saving') : t('quotes.save')}
        </Button>
        <Button type="button" variant="outline" disabled={draft.rows.length === 0 || save.isPending || pdf.isPending} onClick={() => pdf.mutate()}>
          {pdf.isPending ? t('quotes.pdfWorking') : t('quotes.pdf')}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {dirty ? t('quotes.unsaved') : message}
        </span>
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{error.message}</span>
          {stale && (
            <Button type="button" size="sm" variant="outline" onClick={() => location.reload()}>
              {t('quotes.reload')}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

/** Kézi státuszváltás (a tervezetbe vissza nem lehet). */
function StatusCard({ version, onDone }: { version: QuoteVersion; onDone: (q: Quote) => void }) {
  const options = QUOTE_STATUSES.filter((s) => s !== version.status && s !== 'tervezet');
  const [status, setStatus] = useState<QuoteStatus>(options[0]!);
  const change = useMutation({ mutationFn: () => quotesApi.status(version.id, version.revision, status), onSuccess: onDone });
  const apply = () => {
    if (version.status === 'tervezet' && !window.confirm(t('quotes.sendConfirm'))) return;
    change.mutate();
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4 sm:pt-6">
        <h2 className="font-semibold">{t('quotes.changeStatus')}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quote-status">{t('quotes.newStatus')}</Label>
            <Select id="quote-status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus)}>
              {options.map((s) => (
                <option key={s} value={s}>
                  {t(`quotes.status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="outline" disabled={change.isPending || version.items.length === 0} onClick={apply}>
            {t('quotes.applyStatus')}
          </Button>
        </div>
        {change.error && <p role="alert" className="text-sm text-destructive">{change.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function PdfList({ version, timeZone }: { version: QuoteVersion; timeZone: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4 sm:pt-6">
        <h2 className="font-semibold">{t('quotes.pdfs')}</h2>
        {version.pdfs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('quotes.noPdf')}</p>
        ) : (
          <ul aria-label={t('quotes.pdfs')} className="flex flex-col divide-y">
            {version.pdfs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium">{p.fileName}</span>
                  <span className="block text-muted-foreground">
                    <time dateTime={p.createdAt}>{formatDateTime(p.createdAt, timeZone)}</time> · {p.createdBy.name} · {formatFiller(p.totalFiller)}
                  </span>
                </span>
                <a href={pdfUrl(p.id)} download={p.fileName} className="underline">
                  {t('quotes.download')}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
