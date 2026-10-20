import type { ModuleManifest } from '@derp/server/module-api';

// Kiszállás-ütemezés (6. munkacsomag): kiszállások projekthez és kollégákhoz rendelve, napi/heti nézet kollégánként,
// ütközésjelzés, „Mai kiszállásaim”, kollégánkénti tokenes ICS-feed, események az idővonalra.
export default {
  id: 'visits',
  version: '0.1.0',
  menu: [
    { path: '/visits', labelKey: 'visits.menu' },
    { path: '/visits/mine', labelKey: 'visits.menuMine' },
  ],
  eventTypes: [
    { type: 'visits.scheduled', labelKey: 'visits.event.scheduled' },
    { type: 'visits.updated', labelKey: 'visits.event.updated' },
    { type: 'visits.cancelled', labelKey: 'visits.event.cancelled' },
  ],
  // Kiszállást felvenni, módosítani, törölni az iroda tud; megnézni (a terepes csak a sajátját) és az ICS-linket
  // kezelni mindenki.
  permissions: [{ key: 'visits.manage', roles: ['admin', 'iroda'] }],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
  publicRoutes: async (app, ctx) => (await import('./server/routes.ts')).publicRoutes(app, ctx),
} satisfies ModuleManifest;
