import type { ModuleManifest } from '@derp/server/module-api';

// Gmail (11. munkacsomag, mock-forrással; az élő bekötés a 14.): bekötött fiókok csak olvasható betöltése
// (`MAIL_SOURCE`), szálak hozzárendelése projekthez szabály alapú javaslattal és kézzel a „Hozzárendeletlen levelek”
// listából, a hozzárendelt szálak levelei az idővonalon. A felület: modules/gmail/README.md.
export default {
  id: 'gmail',
  version: '0.1.0',
  menu: [{ path: '/gmail', labelKey: 'gmail.menu', roles: ['admin', 'iroda'] }],
  eventTypes: [
    { type: 'gmail.message', labelKey: 'gmail.event.message' },
    // A régi projekt idővonalán, ha a szálat másik projektbe helyezték át.
    { type: 'gmail.thread_moved', labelKey: 'gmail.event.thread_moved' },
  ],
  permissions: [
    // A hozzárendeletlen levelek listája, megnyitása, hozzárendelése és a kézi betöltés.
    { key: 'gmail.assign', roles: ['admin', 'iroda'] },
    { key: 'gmail.rules', roles: ['admin', 'iroda'] },
    // Fiók bekötése (a spec szerint az admin köti be).
    { key: 'gmail.accounts', roles: ['admin'] },
  ],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
  seedE2E: async (ctx) => (await import('./server/seed.ts')).seed(ctx),
} satisfies ModuleManifest;
