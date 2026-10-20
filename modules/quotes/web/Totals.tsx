import { formatFiller } from '../shared/format.ts';
import type { QuoteTotals } from '../shared/money.ts';
import { t } from './i18n.ts';

/** Az összesítő: ÁFA-kulcsonkénti bontás, nettó/ÁFA/bruttó összesen és a forintra kerekített végösszeg. */
export function Totals({ totals }: { totals: QuoteTotals }) {
  return (
    <section aria-label={t('quotes.summary')} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="overflow-x-auto">
        <table aria-label={t('quotes.byVat')} className="text-xs sm:text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th scope="col" className="pr-3 font-normal">{t('quotes.vatRate')}</th>
              <th scope="col" className="pr-3 text-right font-normal">{t('quotes.net')}</th>
              <th scope="col" className="pr-3 text-right font-normal">{t('quotes.vat')}</th>
              <th scope="col" className="text-right font-normal">{t('quotes.gross')}</th>
            </tr>
          </thead>
          <tbody>
            {totals.byVatRate.map((r) => (
              <tr key={r.vatRate}>
                <td className="pr-3">{r.vatRate}%</td>
                <td className="whitespace-nowrap pr-3 text-right tabular-nums">{formatFiller(r.netFiller)}</td>
                <td className="whitespace-nowrap pr-3 text-right tabular-nums">{formatFiller(r.vatFiller)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{formatFiller(r.grossFiller)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 self-end whitespace-nowrap text-sm">
        <dt>{t('quotes.netTotal')}</dt>
        <dd className="text-right tabular-nums">{formatFiller(totals.netFiller)}</dd>
        <dt>{t('quotes.vatTotal')}</dt>
        <dd className="text-right tabular-nums">{formatFiller(totals.vatFiller)}</dd>
        <dt>{t('quotes.grossTotal')}</dt>
        <dd className="text-right tabular-nums">{formatFiller(totals.grossFiller)}</dd>
        {totals.roundingFiller !== 0 && (
          <>
            <dt className="text-muted-foreground">{t('quotes.rounding')}</dt>
            <dd className="text-right tabular-nums text-muted-foreground">{formatFiller(totals.roundingFiller)}</dd>
          </>
        )}
        <dt className="mt-1 text-base font-semibold">{t('quotes.grandTotal')}</dt>
        <dd className="mt-1 text-right text-base font-semibold tabular-nums">
          <output aria-label={t('quotes.grandTotal')}>{formatFiller(totals.totalFiller)}</output>
        </dd>
      </dl>
    </section>
  );
}
