import type { ModuleManifest } from '@derp/server/module-api';

// Helyszíni jegyzet és felmérés: szabad szöveges jegyzet, illetve kötelező mezős felmérés fotókkal (a fotók a `docs`
// modulon át, a felmérés eseménye alá). A felület: modules/notes/README.md.
export default {
  id: 'notes',
  version: '0.1.0',
  dependsOn: ['docs'],
  menu: [{ path: '/notes', labelKey: 'notes.menu' }],
  eventTypes: [
    { type: 'notes.note_added', labelKey: 'notes.event.note_added' },
    { type: 'notes.survey_added', labelKey: 'notes.event.survey_added' },
  ],
  permissions: [{ key: 'notes.write', roles: ['admin', 'iroda', 'terepes'] }],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
} satisfies ModuleManifest;
