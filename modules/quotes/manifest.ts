import type { ModuleManifest } from '@derp/server/module-api';

// Árajánlat (10. munkacsomag): tételsoros ajánlat (a cikktörzsből vagy kézzel), verziók, PDF a cég fejlécével, kézi
// státusz; a szerkesztő mellett a projekt idővonala, fotói (docs) és felmérései (notes). A felület:
// modules/quotes/README.md.
export default {
  id: 'quotes',
  version: '0.1.0',
  dependsOn: ['catalog', 'docs', 'notes'],
  menu: [{ path: '/quotes', labelKey: 'quotes.menu', roles: ['admin', 'iroda'] }],
  eventTypes: [
    { type: 'quotes.created', labelKey: 'quotes.event.created' },
    { type: 'quotes.version_created', labelKey: 'quotes.event.version_created' },
    { type: 'quotes.status_changed', labelKey: 'quotes.event.status_changed' },
    { type: 'quotes.pdf_created', labelKey: 'quotes.event.pdf_created' },
  ],
  permissions: [
    // Ajánlat megnyitása, szerkesztése, PDF, státusz (az árak miatt a terepes nem látja).
    { key: 'quotes.manage', roles: ['admin', 'iroda'] },
    // A PDF fejléce (cégadatok, logó).
    { key: 'quotes.settings', roles: ['admin'] },
  ],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
  seedE2E: async (ctx) => (await import('./server/seed.ts')).seed(ctx),
} satisfies ModuleManifest;
