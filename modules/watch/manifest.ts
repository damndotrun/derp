import type { ModuleManifest } from '@derp/server/module-api';

// Mappafigyelő: egy szerver-mappa (WATCH_ROOT) csak olvasható figyelése; projektenként egy almappa rendelhető hozzá, a
// fájlváltozások (új, módosult, törölt, átnevezett) eseményként az idővonalra kerülnek. A felület: modules/watch/README.md.
export default {
  id: 'watch',
  version: '0.1.0',
  menu: [{ path: '/watch', labelKey: 'watch.menu' }],
  eventTypes: [
    { type: 'watch.file_added', labelKey: 'watch.event.file_added' },
    { type: 'watch.file_modified', labelKey: 'watch.event.file_modified' },
    { type: 'watch.file_deleted', labelKey: 'watch.event.file_deleted' },
    { type: 'watch.file_renamed', labelKey: 'watch.event.file_renamed' },
  ],
  permissions: [
    // Almappa hozzárendelése, megszüntetése, a figyelt gyökér böngészése.
    { key: 'watch.manage', roles: ['admin', 'iroda'] },
    // „Most ellenőrizd” a látható projekteken.
    { key: 'watch.scan', roles: ['admin', 'iroda', 'terepes'] },
  ],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
} satisfies ModuleManifest;
