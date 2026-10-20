import type { ModuleManifest } from '@derp/server/module-api';

// Projekt-chat: projektenként egy üzenetszál, fotó/fájl csatolással (a `docs` modulon át), @említéssel,
// olvasottsággal és élő frissüléssel. A felület: modules/chat/README.md.
export default {
  id: 'chat',
  version: '0.1.0',
  dependsOn: ['docs'],
  menu: [{ path: '/chat', labelKey: 'chat.menu' }],
  eventTypes: [{ type: 'chat.message_posted', labelKey: 'chat.event.message_posted' }],
  permissions: [{ key: 'chat.post', roles: ['admin', 'iroda', 'terepes'] }],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
} satisfies ModuleManifest;
