import type { ModuleManifest } from '@derp/server/module-api';

// Minta modul: a modulkeret próbája és mintája (menüpont, oldal, útvonal, migráció, esemény, seedE2E, i18n).
export default {
  id: 'example',
  version: '0.1.0',
  menu: [{ path: '/example', labelKey: 'example.menu' }],
  eventTypes: [{ type: 'example.pinged', labelKey: 'example.event.pinged' }],
  permissions: [{ key: 'example.ping', roles: ['admin', 'iroda', 'terepes'] }],
  // A szerver oldali kód csak bekapcsolt modulnál töltődik be.
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),
  seedE2E: async (ctx) => (await import('./server/seed.ts')).seed(ctx),
} satisfies ModuleManifest;
