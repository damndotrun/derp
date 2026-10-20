import type { ModuleManifest } from '@derp/server/module-api';

// Cikktörzs (9. munkacsomag): cikkek (cikkszám, megnevezés, egység, nettó egységár, ÁFA-kulcs, beszállító),
// CSV-import előnézettel és hibasor-jelzéssel, keresés. Az árajánlat (10.) innen vesz fel tételt; a felület:
// modules/catalog/README.md.
export default {
  id: 'catalog',
  version: '0.1.0',
  menu: [{ path: '/catalog', labelKey: 'catalog.menu' }],
  // Keresni és megnézni mindenki tud (a felmérés becsült anyagához is); importálni az iroda és az admin.
  permissions: [{ key: 'catalog.manage', roles: ['admin', 'iroda'] }],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
  seedE2E: async (ctx) => (await import('./server/seed.ts')).seed(ctx),
} satisfies ModuleManifest;
