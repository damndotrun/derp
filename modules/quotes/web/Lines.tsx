import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { fill } from '@/core/i18n.ts';
import { cn } from '@/lib/utils';
import { VAT_RATES } from '../../catalog/shared/schemas.ts';
import { formatFiller, formatQuantity } from '../shared/format.ts';
import type { QuoteTotals } from '../shared/money.ts';
import type { QuoteItem } from '../shared/schemas.ts';
import { parseRow, type Row, type RowField, type VatRate } from './editor.ts';
import { t } from './i18n.ts';

// Egy tétel egy kártya: felül a megnevezés és a sorrend/törlés gombjai, alatta a számmezők (telefonon két oszlopban,
// szélesebb kijelzőn egy sorban).
const GRID = 'grid grid-cols-2 items-end gap-2 sm:grid-cols-[4.5rem_3.5rem_minmax(5.5rem,1fr)_4rem_5rem_minmax(5.5rem,1fr)]';

/** Mezőfelirat (a beviteli mező akadálymentes neve a sorszámmal együtt az `aria-label`). */
function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span aria-hidden className="text-xs text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

const origin = (r: { catalogItemId: string | null; sku: string }) =>
  r.catalogItemId ? `${r.sku} · ${t('quotes.item.fromCatalog')}` : t('quotes.item.manual');

/** A tervezet tételei szerkeszthetően. */
export function LinesEditor({
  rows,
  totals,
  onChange,
  onRemove,
  onMove,
}: {
  rows: Row[];
  totals: QuoteTotals;
  onChange: (id: string, patch: Partial<Row>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('quotes.noItems')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label={t('quotes.items')} className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const n = i + 1;
          const errors = new Set<RowField>(parseRow(r).errors);
          // Az üres új sor mezői ne legyenek rögtön pirosak, csak ha valamit már beírtak.
          const touched = r.name !== '' || r.price !== '';
          const bad = (f: RowField) => touched && errors.has(f);
          const input = (f: RowField) => cn(bad(f) && 'border-destructive focus-visible:ring-destructive');
          return (
            <li key={r.id} aria-label={fill(t('quotes.item.label'), { n, name: r.name || '–' })} className="flex flex-col gap-2 rounded-md border p-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-2">
                <Field label={`${n}. ${t('quotes.item.name')}`} className="flex-1">
                  <Input aria-label={`${t('quotes.item.name')} ${n}`} aria-invalid={bad('name')} className={input('name')} value={r.name} onChange={(e) => onChange(r.id, { name: e.target.value })} />
                  <span className="text-xs text-muted-foreground">{origin(r)}</span>
                </Field>
                <div className="flex shrink-0 gap-1 self-end">
                  <Button type="button" variant="ghost" size="icon" aria-label={`${t('quotes.item.up')} ${n}`} title={t('quotes.item.up')} disabled={i === 0} onClick={() => onMove(r.id, -1)}>
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('quotes.item.down')} ${n}`}
                    title={t('quotes.item.down')}
                    disabled={i === rows.length - 1}
                    onClick={() => onMove(r.id, 1)}
                  >
                    ↓
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${t('quotes.item.remove')} ${n}`} title={t('quotes.item.remove')} onClick={() => onRemove(r.id)}>
                    ✕
                  </Button>
                </div>
              </div>
              <div className={GRID}>
                <Field label={t('quotes.item.quantity')}>
                  <Input
                    aria-label={`${t('quotes.item.quantity')} ${n}`}
                    aria-invalid={bad('quantity')}
                    inputMode="decimal"
                    className={cn('text-right', input('quantity'))}
                    value={r.quantity}
                    onChange={(e) => onChange(r.id, { quantity: e.target.value })}
                  />
                </Field>
                <Field label={t('quotes.item.unit')}>
                  <Input aria-label={`${t('quotes.item.unit')} ${n}`} aria-invalid={bad('unit')} className={input('unit')} value={r.unit} onChange={(e) => onChange(r.id, { unit: e.target.value })} />
                </Field>
                <Field label={t('quotes.item.priceShort')}>
                  <Input
                    aria-label={`${t('quotes.item.price')} ${n}`}
                    aria-invalid={bad('price')}
                    inputMode="decimal"
                    className={cn('text-right', input('price'))}
                    value={r.price}
                    onChange={(e) => onChange(r.id, { price: e.target.value })}
                  />
                </Field>
                <Field label={`${t('quotes.item.discountShort')} %`}>
                  <Input
                    aria-label={`${t('quotes.item.discount')} ${n}`}
                    aria-invalid={bad('discount')}
                    inputMode="decimal"
                    className={cn('text-right', input('discount'))}
                    value={r.discount}
                    onChange={(e) => onChange(r.id, { discount: e.target.value })}
                  />
                </Field>
                <Field label={t('quotes.item.vat')}>
                  <Select aria-label={`${t('quotes.item.vat')} ${n}`} value={r.vatRate} onChange={(e) => onChange(r.id, { vatRate: Number(e.target.value) as VatRate })}>
                    {VAT_RATES.map((v) => (
                      <option key={v} value={v}>
                        {v}%
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('quotes.item.net')} className="items-end">
                  <span className="flex h-9 items-center justify-end whitespace-nowrap text-sm tabular-nums" aria-label={`${t('quotes.item.net')} ${n}`}>
                    {formatFiller(totals.lineNetFiller[i] ?? 0)}
                  </span>
                </Field>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Egy nem szerkeszthető verzió tételei. */
export function LinesView({ items, totals }: { items: QuoteItem[]; totals: QuoteTotals }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t('quotes.noItems')}</p>;
  return (
    <table aria-label={t('quotes.items')} className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="p-2 font-normal">{t('quotes.item.name')}</th>
          <th scope="col" className="p-2 text-right font-normal">{t('quotes.item.quantity')}</th>
          <th scope="col" className="hidden p-2 text-right font-normal sm:table-cell">{t('quotes.item.priceShort')}</th>
          <th scope="col" className="hidden p-2 text-right font-normal sm:table-cell">{t('quotes.item.discountShort')}</th>
          <th scope="col" className="hidden p-2 text-right font-normal sm:table-cell">{t('quotes.item.vat')}</th>
          <th scope="col" className="p-2 text-right font-normal">{t('quotes.item.net')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i, n) => (
          <tr key={i.id} className="border-b align-top">
            <td className="p-2">
              <span className="break-words">{i.name}</span>
              <span className="block text-xs text-muted-foreground">{origin(i)}</span>
              <span className="block text-xs text-muted-foreground sm:hidden">
                {formatFiller(i.netUnitPriceFiller)} / {i.unit} · {i.vatRate}%{i.discountPercent ? ` · −${i.discountPercent}%` : ''}
              </span>
            </td>
            <td className="whitespace-nowrap p-2 text-right tabular-nums">
              {formatQuantity(i.quantity)} {i.unit}
            </td>
            <td className="hidden whitespace-nowrap p-2 text-right tabular-nums sm:table-cell">{formatFiller(i.netUnitPriceFiller)}</td>
            <td className="hidden p-2 text-right tabular-nums sm:table-cell">{i.discountPercent ? `${i.discountPercent}%` : '–'}</td>
            <td className="hidden p-2 text-right tabular-nums sm:table-cell">{i.vatRate}%</td>
            <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatFiller(totals.lineNetFiller[n] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
