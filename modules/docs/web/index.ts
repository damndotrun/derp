import type { WebModule } from '@/core/module-types.ts';
import { DocsHomePage } from './DocsHomePage.tsx';
import { FileUploadedEvent } from './FileUploadedEvent.tsx';
import { messages } from './i18n.ts';
import { ProjectDocsPage } from './ProjectDocsPage.tsx';
import { sendUpload, type PreparedUpload } from './upload.ts';

export default {
  id: 'docs',
  messages,
  routes: [
    { path: '/docs', Component: DocsHomePage },
    { path: '/docs/:projectId', Component: ProjectDocsPage },
  ],
  eventRenderers: { 'docs.file_uploaded': FileUploadedEvent },
  projectLinks: [{ labelKey: 'docs.menu', to: (projectId) => `/docs/${projectId}` }],
  // Terepi mód (8.): a dokumentumtárba feltöltött fotó offline is elkészülhet; a projekt fájllistája a telefonon.
  outbox: { 'docs.upload': { send: (u: PreparedUpload) => sendUpload(u) } },
  offlineUrls: { project: (projectId) => [`/api/docs/projects/${projectId}`] },
} satisfies WebModule;
