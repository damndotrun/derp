import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { t as coreT } from '@/core/i18n.ts';
import { LoadError } from '@/core/LoadError.tsx';
import { isAdmin, useUser } from '@/core/session.ts';
import { LOGO_MAX_BYTES, LOGO_TYPES, type LogoUpload, type Settings, type SettingsUpdate } from '../shared/schemas.ts';
import { LOGO_URL, quotesApi, settingsKey } from './api.ts';
import { t } from './i18n.ts';

type Field = Exclude<keyof SettingsUpdate, 'version'>;
const FIELDS: Array<{ key: Field; label: Parameters<typeof t>[0]; multiline?: boolean }> = [
  { key: 'companyName', label: 'quotes.settings.companyName' },
  { key: 'address', label: 'quotes.settings.address' },
  { key: 'taxNumber', label: 'quotes.settings.taxNumber' },
  { key: 'phone', label: 'quotes.settings.phone' },
  { key: 'email', label: 'quotes.settings.email' },
  { key: 'bankAccount', label: 'quotes.settings.bankAccount' },
  { key: 'footer', label: 'quotes.settings.footer', multiline: true },
];

async function fileToLogo(file: File): Promise<LogoUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime: file.type as LogoUpload['mime'], content: btoa(binary) };
}

/** A PDF fejléce: a cég adatai és a logó (a magban nincs beállítás-tár, ezért a modul saját beállítása). Írni az admin tud. */
export function SettingsPage() {
  const settings = useQuery({ queryKey: settingsKey, queryFn: quotesApi.settings, retry: false });
  if (settings.isPending) return <p>{coreT('common.loading')}</p>;
  if (settings.isError) return <LoadError error={settings.error} notFound={t('quotes.notFound')} forbidden={t('quotes.forbidden')} back={{ to: '/quotes', label: t('quotes.backToList') }} />;
  return <SettingsForm key={settings.data.version} settings={settings.data} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const admin = isAdmin(useUser());
  const [values, setValues] = useState<Record<Field, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, settings[f.key]])) as Record<Field, string>);
  const [logoError, setLogoError] = useState<string | null>(null);
  const done = (s: Settings) => queryClient.setQueryData(settingsKey, s);
  const save = useMutation({ mutationFn: () => quotesApi.saveSettings({ version: settings.version, ...values }), onSuccess: done });
  const upload = useMutation({ mutationFn: async (file: File) => quotesApi.uploadLogo(await fileToLogo(file)), onSuccess: done });
  const remove = useMutation({ mutationFn: quotesApi.removeLogo, onSuccess: done });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const pick = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return setLogoError(t('quotes.settings.logoType'));
    if (file.size > LOGO_MAX_BYTES) return setLogoError(t('quotes.settings.logoTooLarge'));
    upload.mutate(file);
  };
  const error = save.error ?? upload.error ?? remove.error;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/quotes" className="text-sm text-muted-foreground hover:underline">
          ← {t('quotes.backToList')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('quotes.settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('quotes.settings.hint')}</p>
        {!admin && <p className="mt-1 text-sm">{t('quotes.settings.readOnly')}</p>}
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('quotes.settings.logo')}</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {settings.hasLogo ? (
            <img src={`${LOGO_URL}?v=${settings.version}`} alt={t('quotes.settings.logo')} className="max-h-20 max-w-60 self-start object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">{t('quotes.settings.noLogo')}</p>
          )}
          {admin && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quote-logo">{t('quotes.settings.uploadLogo')}</Label>
                <Input id="quote-logo" type="file" accept={LOGO_TYPES.join(',')} disabled={upload.isPending} onChange={(e) => pick(e.target.files?.[0])} />
                <span className="text-xs text-muted-foreground">{t('quotes.settings.logoHint')}</span>
              </div>
              {settings.hasLogo && (
                <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {t('quotes.settings.removeLogo')}
                </Button>
              )}
            </div>
          )}
          {logoError && <p role="alert" className="text-sm text-destructive">{logoError}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.multiline ? 'flex flex-col gap-1.5 sm:col-span-2' : 'flex flex-col gap-1.5'}>
                <Label htmlFor={`quote-settings-${f.key}`}>{t(f.label)}</Label>
                {f.multiline ? (
                  <Textarea id={`quote-settings-${f.key}`} rows={2} disabled={!admin} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <Input id={`quote-settings-${f.key}`} disabled={!admin} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </div>
            ))}
            {admin && (
              <div className="sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {coreT('common.save')}
                </Button>
              </div>
            )}
          </form>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
