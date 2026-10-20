import { request } from '@/core/api.ts';
import type { LogoUpload, Quote, QuoteList, QuotePdf, QuoteStatus, Settings, SettingsUpdate, VersionUpdate } from '../shared/schemas.ts';

export const quotesKey = ['quotes'] as const;
export const quoteKey = (quoteId: string) => ['quotes', 'quote', quoteId] as const;
export const projectQuotesKey = (projectId: string) => ['quotes', 'project', projectId] as const;
export const settingsKey = ['quotes', 'settings'] as const;

/** A PDF letöltési címe. */
export const pdfUrl = (pdfId: string) => `/api/quotes/pdfs/${pdfId}`;
export const LOGO_URL = '/api/quotes/settings/logo';

export const quotesApi = {
  list: () => request<QuoteList>('GET', '/api/quotes'),
  project: (projectId: string) => request<QuoteList>('GET', `/api/quotes/projects/${projectId}`),
  create: (projectId: string) => request<Quote>('POST', `/api/quotes/projects/${projectId}`),
  quote: (quoteId: string) => request<Quote>('GET', `/api/quotes/${quoteId}`),
  newVersion: (quoteId: string) => request<Quote>('POST', `/api/quotes/${quoteId}/versions`),
  save: (versionId: string, body: VersionUpdate) => request<Quote>('PUT', `/api/quotes/versions/${versionId}`, body),
  status: (versionId: string, revision: number, status: QuoteStatus) =>
    request<Quote>('POST', `/api/quotes/versions/${versionId}/status`, { revision, status }),
  pdf: (versionId: string, revision: number) => request<QuotePdf>('POST', `/api/quotes/versions/${versionId}/pdf`, { revision }),
  settings: () => request<Settings>('GET', '/api/quotes/settings'),
  saveSettings: (body: SettingsUpdate) => request<Settings>('PUT', '/api/quotes/settings', body),
  uploadLogo: (body: LogoUpload) => request<Settings>('PUT', LOGO_URL, body),
  removeLogo: () => request<Settings>('DELETE', LOGO_URL),
};

/** A böngészőben letölti a PDF-et (a szerver `Content-Disposition: attachment`-tel küldi). */
export function downloadPdf(pdf: Pick<QuotePdf, 'id' | 'fileName'>) {
  const a = document.createElement('a');
  a.href = pdfUrl(pdf.id);
  a.download = pdf.fileName;
  document.body.append(a);
  a.click();
  a.remove();
}
