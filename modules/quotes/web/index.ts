import type { WebModule } from '@/core/module-types.ts';
import { messages } from './i18n.ts';
import { ProjectQuotesPage } from './ProjectQuotesPage.tsx';
import { QuoteEvent } from './QuoteEvents.tsx';
import { QuotePage } from './QuotePage.tsx';
import { QuotesHomePage } from './QuotesHomePage.tsx';
import { SettingsPage } from './SettingsPage.tsx';

export default {
  id: 'quotes',
  messages,
  routes: [
    { path: '/quotes', Component: QuotesHomePage },
    { path: '/quotes/settings', Component: SettingsPage },
    { path: '/quotes/projects/:projectId', Component: ProjectQuotesPage },
    { path: '/quotes/:quoteId', Component: QuotePage },
  ],
  eventRenderers: {
    'quotes.created': QuoteEvent,
    'quotes.version_created': QuoteEvent,
    'quotes.status_changed': QuoteEvent,
    'quotes.pdf_created': QuoteEvent,
  },
  projectLinks: [{ labelKey: 'quotes.projectLink', to: (projectId) => `/quotes/projects/${projectId}`, roles: ['admin', 'iroda'] }],
} satisfies WebModule;
