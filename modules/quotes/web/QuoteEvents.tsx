import { Link } from 'react-router';
import { DefaultEvent } from '@/core/DefaultEvent.tsx';
import type { EventRendererProps } from '@/core/module-types.ts';
import { isOffice, useUser } from '@/core/session.ts';
import { QUOTE_STATUSES, type PdfEventData, type QuoteEventData } from '../shared/schemas.ts';
import { pdfUrl } from './api.ts';
import { t } from './i18n.ts';
import { StatusBadge } from './StatusBadge.tsx';

const quoteData = (data: Record<string, unknown>): QuoteEventData | null =>
  typeof data.quoteId === 'string' && typeof data.number === 'number' && (QUOTE_STATUSES as readonly unknown[]).includes(data.status)
    ? (data as unknown as QuoteEventData)
    : null;

/**
 * Az ajánlat eseményei az idővonalon (létrehozás, új verzió, státuszváltás, PDF): a státusz, és az irodának link az
 * ajánlatra, illetve a PDF letöltésére. Az összeg nincs az eseményben (a terepes is látja a projekt idővonalát).
 */
export function QuoteEvent(props: EventRendererProps) {
  const d = quoteData(props.event.data);
  const office = isOffice(useUser());
  if (!d) return <DefaultEvent {...props} />;
  const pdf = props.event.type === 'quotes.pdf_created' ? (d as PdfEventData) : null;
  return (
    <DefaultEvent {...props}>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        {!pdf && <StatusBadge status={d.status} />}
        {office && (
          <Link to={`/quotes/${d.quoteId}`} className="underline">
            {t('quotes.open')}
          </Link>
        )}
        {office && pdf && typeof pdf.pdfId === 'string' && (
          <a href={pdfUrl(pdf.pdfId)} download={pdf.fileName} className="underline">
            {t('quotes.download')}
          </a>
        )}
      </p>
    </DefaultEvent>
  );
}
