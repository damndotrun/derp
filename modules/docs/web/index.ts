import type { WebModule } from '@/core/module-types.ts';
import { DocsHomePage } from './DocsHomePage.tsx';
import { FileUploadedEvent } from './FileUploadedEvent.tsx';
import { messages } from './i18n.ts';
import { ProjectDocsPage } from './ProjectDocsPage.tsx';

export default {
  id: 'docs',
  messages,
  routes: [
    { path: '/docs', Component: DocsHomePage },
    { path: '/docs/:projectId', Component: ProjectDocsPage },
  ],
  eventRenderers: { 'docs.file_uploaded': FileUploadedEvent },
  projectLinks: [{ labelKey: 'docs.menu', to: (projectId) => `/docs/${projectId}` }],
} satisfies WebModule;
