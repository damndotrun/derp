import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fill } from '@/core/i18n.ts';
import { submit as submitOutbox } from '@/core/outbox.ts';
import type { Note, Survey } from '../shared.ts';
import { t } from './i18n.ts';
import { parseQuantity, prepareNote, prepareSurvey, type PreparedNote, type PreparedSurvey, type SurveyProgress } from './save.ts';

/** Az offline sor elemfajtái (`web/index.ts`). */
export const NOTES_OUTBOX = { survey: 'notes.survey', note: 'notes.note' } as const;

const short = (s: string, max = 60) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

interface MaterialRow {
  key: number;
  name: string;
  quantity: string;
  unit: string;
}

type FieldErrors = Partial<Record<'location' | 'condition' | 'proposedWork' | 'materials', string>> & {
  rows?: Record<number, Partial<Record<'name' | 'quantity' | 'unit', string>>>;
};

/** A felmérés mezőinek ellenőrzése a kliensen (a szerver ugyanezt nézi, 400-zal). */
export function validateSurvey(f: { location: string; condition: string; proposedWork: string; materials: MaterialRow[] }): FieldErrors {
  const errors: FieldErrors = {};
  const required = t('notes.required');
  if (!f.location.trim()) errors.location = required;
  if (!f.condition.trim()) errors.condition = required;
  if (!f.proposedWork.trim()) errors.proposedWork = required;
  if (f.materials.length === 0) errors.materials = required;
  const rows: NonNullable<FieldErrors['rows']> = {};
  for (const m of f.materials) {
    const e: Partial<Record<'name' | 'quantity' | 'unit', string>> = {};
    if (!m.name.trim()) e.name = required;
    if (!m.quantity.trim()) e.quantity = required;
    else if (parseQuantity(m.quantity) === null) e.quantity = t('notes.quantityInvalid');
    if (!m.unit.trim()) e.unit = required;
    if (Object.keys(e).length > 0) rows[m.key] = e;
  }
  if (Object.keys(rows).length > 0) errors.rows = rows;
  return errors;
}

const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {text}
    </p>
  );
}

function PhotoInputs({ disabled, onAdd }: { disabled: boolean; onAdd: (files: File[]) => void }) {
  const add = (list: FileList | null) => {
    if (list) onAdd(Array.from(list));
  };
  return (
    <div className="flex flex-wrap gap-2">
      <label className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border px-3 text-sm hover:bg-accent">
        <span aria-hidden>🖼️</span> {t('notes.addPhotos')}
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label={t('notes.addPhotos')}
          disabled={disabled}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      <label className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border px-3 text-sm hover:bg-accent md:hidden">
        <span aria-hidden>📷</span> {t('notes.takePhoto')}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label={t('notes.takePhoto')}
          disabled={disabled}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/**
 * Új felmérés: a kötelező mezők (helyszín, észlelt állapot, javasolt munka, becsült anyag tételesen) és a fotók. Hiba
 * után az „Újra” ugyanazokkal az azonosítókkal küld, így sem a felmérés, sem a fotók nem duplikálódnak. Az offline
 * soron át megy: hálózat nélkül a felmérés a fotóival a telefonon vár (`onSaved()` felmérés nélkül), és magától felmegy.
 */
export function SurveyForm({ projectId, onSaved, onCancel }: { projectId: string; onSaved: (s?: Survey) => void; onCancel: () => void }) {
  const id = useId();
  const nextKey = useRef(1);
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [proposedWork, setProposedWork] = useState('');
  const [materials, setMaterials] = useState<MaterialRow[]>([{ key: 0, name: '', quantity: '', unit: t('notes.material.defaultUnit') }]);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [pending, setPending] = useState<PreparedSurvey | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = !!pending;

  const fields = { location, condition, proposedWork, materials };
  // Az első mentési kísérlet után a hibák gépelés közben frissülnek.
  const shown = errors ? validateSurvey(fields) : {};

  const setRow = (key: number, patch: Partial<MaterialRow>) => setMaterials((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setMaterials((rows) => [...rows, { key: nextKey.current++, name: '', quantity: '', unit: t('notes.material.defaultUnit') }]);

  const save = async (prepared?: PreparedSurvey) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const s =
        prepared ??
        (await prepareSurvey(
          projectId,
          { location, condition, proposedWork, materials: materials.map((m) => ({ name: m.name, quantity: parseQuantity(m.quantity)!, unit: m.unit })) },
          files,
        ));
      setPending(s);
      setProgress(s.photos.length > 0 ? { done: 0, total: s.photos.length } : null);
      const outcome = await submitOutbox(
        NOTES_OUTBOX.survey,
        s,
        { id: s.id, projectId, label: `${t('notes.outboxSurvey')}: ${short(s.location)}` },
        { onProgress: (p) => setProgress({ done: (p as SurveyProgress).uploaded, total: s.photos.length }) },
      );
      setPending(null);
      onSaved(outcome.status === 'sent' ? (outcome.result as { survey: Survey }).survey : undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return void save(pending);
    const found = validateSurvey(fields);
    setErrors(found);
    if (!hasErrors(found)) void save();
  };

  const err = (name: string) => `${id}-${name}-error`;
  const rowErr = (key: number, name: string) => `${id}-m${key}-${name}-error`;

  return (
    <form aria-label={t('notes.newSurvey')} noValidate onSubmit={submit} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">{t('notes.newSurvey')}</h2>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-location`}>{t('notes.location')} *</Label>
        <Input
          id={`${id}-location`}
          value={location}
          readOnly={locked}
          required
          aria-invalid={!!shown.location}
          aria-describedby={shown.location ? err('location') : undefined}
          onChange={(e) => setLocation(e.target.value)}
        />
        <FieldError id={err('location')} text={shown.location} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-condition`}>{t('notes.condition')} *</Label>
        <Textarea
          id={`${id}-condition`}
          rows={3}
          value={condition}
          readOnly={locked}
          required
          aria-invalid={!!shown.condition}
          aria-describedby={shown.condition ? err('condition') : undefined}
          onChange={(e) => setCondition(e.target.value)}
        />
        <FieldError id={err('condition')} text={shown.condition} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-work`}>{t('notes.proposedWork')} *</Label>
        <Textarea
          id={`${id}-work`}
          rows={3}
          value={proposedWork}
          readOnly={locked}
          required
          aria-invalid={!!shown.proposedWork}
          aria-describedby={shown.proposedWork ? err('proposedWork') : undefined}
          onChange={(e) => setProposedWork(e.target.value)}
        />
        <FieldError id={err('proposedWork')} text={shown.proposedWork} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('notes.materials')} *</legend>
        <ol aria-label={t('notes.materials')} className="flex flex-col gap-2">
          {materials.map((m, i) => {
            const e = shown.rows?.[m.key] ?? {};
            const n = i + 1;
            return (
              <li key={m.key} className="grid grid-cols-[1fr_5.5rem_4.5rem_auto] items-start gap-2">
                <div>
                  <Input
                    aria-label={`${t('notes.material.name')} ${n}`}
                    placeholder={t('notes.material.name')}
                    value={m.name}
                    readOnly={locked}
                    aria-invalid={!!e.name}
                    aria-describedby={e.name ? rowErr(m.key, 'name') : undefined}
                    onChange={(ev) => setRow(m.key, { name: ev.target.value })}
                  />
                  <FieldError id={rowErr(m.key, 'name')} text={e.name} />
                </div>
                <div>
                  <Input
                    aria-label={`${t('notes.material.quantity')} ${n}`}
                    placeholder={t('notes.material.quantity')}
                    inputMode="decimal"
                    value={m.quantity}
                    readOnly={locked}
                    aria-invalid={!!e.quantity}
                    aria-describedby={e.quantity ? rowErr(m.key, 'quantity') : undefined}
                    onChange={(ev) => setRow(m.key, { quantity: ev.target.value })}
                  />
                  <FieldError id={rowErr(m.key, 'quantity')} text={e.quantity} />
                </div>
                <div>
                  <Input
                    aria-label={`${t('notes.material.unit')} ${n}`}
                    placeholder={t('notes.material.unit')}
                    value={m.unit}
                    readOnly={locked}
                    aria-invalid={!!e.unit}
                    aria-describedby={e.unit ? rowErr(m.key, 'unit') : undefined}
                    onChange={(ev) => setRow(m.key, { unit: ev.target.value })}
                  />
                  <FieldError id={rowErr(m.key, 'unit')} text={e.unit} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('notes.material.remove')} ${n}`}
                  disabled={locked || materials.length === 1}
                  onClick={() => setMaterials((rows) => rows.filter((r) => r.key !== m.key))}
                >
                  ×
                </Button>
              </li>
            );
          })}
        </ol>
        <FieldError id={err('materials')} text={shown.materials} />
        <div>
          <Button type="button" variant="outline" size="sm" disabled={locked} onClick={addRow}>
            + {t('notes.material.add')}
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('notes.photos')}</legend>
        <PhotoInputs disabled={locked} onAdd={(f) => setFiles((all) => [...all, ...f])} />
        {files.length > 0 && (
          <ul aria-label={t('notes.photos')} className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm">
                🖼️ {f.name}
                {!locked && (
                  <button
                    type="button"
                    aria-label={`${t('notes.removePhoto')}: ${f.name}`}
                    className="px-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {errors && hasErrors(shown) && (
        <p role="alert" className="text-sm text-destructive">
          {t('notes.fixErrors')}
        </p>
      )}
      {progress && saving && <p className="text-sm text-muted-foreground">{fill(t('notes.uploading'), progress)}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('notes.saveError')}: {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? t('notes.saving') : pending ? t('notes.retry') : t('notes.saveSurvey')}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          {t('notes.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Új szabad szöveges helyszíni jegyzet; hiba után az „Újra” ugyanazzal az azonosítóval küld. */
export function NoteForm({ projectId, onSaved, onCancel }: { projectId: string; onSaved: (n?: Note) => void; onCancel: () => void }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<PreparedNote | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const missing = tried && !body.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (saving || (!pending && !body.trim())) return;
    setSaving(true);
    setError(null);
    try {
      const n = pending ?? prepareNote(projectId, body);
      setPending(n);
      const outcome = await submitOutbox(NOTES_OUTBOX.note, n, { id: n.id, projectId, label: `${t('notes.outboxNote')}: ${short(n.body)}` });
      setPending(null);
      onSaved(outcome.status === 'sent' ? (outcome.result as Note) : undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form aria-label={t('notes.newNote')} noValidate onSubmit={submit} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">{t('notes.newNote')}</h2>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-body`}>{t('notes.body')} *</Label>
        <Textarea
          id={`${id}-body`}
          rows={4}
          value={body}
          readOnly={!!pending}
          required
          aria-invalid={missing}
          aria-describedby={missing ? `${id}-body-error` : undefined}
          onChange={(e) => setBody(e.target.value)}
        />
        <FieldError id={`${id}-body-error`} text={missing ? t('notes.required') : undefined} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('notes.saveError')}: {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? t('notes.saving') : pending ? t('notes.retry') : t('notes.saveNote')}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          {t('notes.cancel')}
        </Button>
      </div>
    </form>
  );
}
