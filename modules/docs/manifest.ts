import type { ModuleManifest } from '@derp/server/module-api';
import { MANAGE_ROLES, UPLOAD_ROLES } from './server/permissions.ts';

// Dokumentumtár: fotók és fájlok projektmappákban, bélyegképpel, tartalom szerint címzett tárolással (sha256).
// A jegyzet/felmérés (5.) és a chat (7.) csatolmányai is ide kerülnek; a felület: modules/docs/README.md.
export default {
  id: 'docs',
  version: '0.1.0',
  menu: [{ path: '/docs', labelKey: 'docs.menu' }],
  eventTypes: [
    { type: 'docs.file_uploaded', labelKey: 'docs.event.file_uploaded' },
    { type: 'docs.file_deleted', labelKey: 'docs.event.file_deleted' },
  ],
  permissions: [
    { key: 'docs.upload', roles: UPLOAD_ROLES },
    { key: 'docs.manage', roles: MANAGE_ROLES },
  ],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
} satisfies ModuleManifest;
