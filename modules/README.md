# Modulok

Minden modul egy könyvtár: `modules/<id>/`. Az `id` kisbetűs (`[a-z][a-z0-9_]*`), és egyben az eseménytípusok,
jogosultságok és i18n-kulcsok előtagja (`<id>.`). Új modulhoz a mag nem módosul; a minta az [`example`](example/).

```
modules/<id>/
  manifest.ts          szerver oldali leíró (alapértelmezett export, `satisfies ModuleManifest`)
  migrations/*.sql     a modul migrációi (fájlnév szerint sorban; a modul táblái `<id>_` előtagúak)
  server/              útvonalak, seed, a modul szerver oldali kódja
  web/index.ts         kliens oldali rész (alapértelmezett export, `satisfies WebModule`)
  web/i18n.ts          a modul felületi szövegei
  test/                szerver oldali Vitest-tesztek (valódi adatbázissal, a `pnpm test` futtatja)
  web/**/*.test.tsx    kliens oldali Vitest-tesztek (jsdom)
  e2e/*.spec.ts        a modul saját Playwright-tesztjei (a `pnpm e2e` futtatja)
```

## Felfedezés és bekapcsolás

- A szerver induláskor beolvassa a `modules/*/manifest.ts` fájlokat; a `DERP_MODULES` (`*` = mind, üres = egyik sem,
  különben vesszős lista) dönti el, melyik aktív. Ismeretlen modul, hiányzó vagy körkörös függőség (`dependsOn`) és
  ütköző menü-útvonal esetén a szerver nem indul el.
- A migrációk sorrendje: a mag (`apps/server/src/core/migrations/`), majd a bekapcsolt modulok függőségi sorrendben.
- A kliens `import.meta.glob`-bal minden `modules/*/web/index.ts`-t a buildbe tesz; a menüpontokat és azt, hogy egy
  modul oldala elérhető-e, a `GET /api/modules` válaszából tudja.
- A `pnpm seed:e2e` a mag tesztfelhasználói után a bekapcsolt modulok `seedE2E` hookját hívja, függőségi sorrendben.

## Szerver oldal (`manifest.ts`)

```ts
import type { ModuleManifest } from '@derp/server/module-api';

export default {
  id: 'example',
  version: '0.1.0',
  dependsOn: [],                                    // más modulok azonosítói
  menu: [{ path: '/example', labelKey: 'example.menu' }],   // `roles`-szal szűkíthető
  eventTypes: [{ type: 'example.pinged', labelKey: 'example.event.pinged' }],
  permissions: [{ key: 'example.ping', roles: ['admin', 'iroda', 'terepes'] }],
  routes: async (app, ctx) => (await import('./server/routes.ts')).routes(app, ctx),  // belépés kell
  // publicRoutes: belépés nélküli útvonalak (pl. tokenes ICS-feed)
  seedE2E: async (ctx) => (await import('./server/seed.ts')).seed(ctx),
} satisfies ModuleManifest;
```

A modul a magból csak típust importál (`@derp/server/module-api`); a futásidejű segédeket a `ctx` adja:
`ctx.db` (Drizzle), `ctx.pool`, `ctx.config`, `ctx.appendEvent(...)` (csak a manifestben felvett eseménytípussal;
tranzakcióban második paraméterként a `tx`), `ctx.requireProject(req, id)`, `ctx.visibleProjectIds(req)`,
`ctx.audit(req, entry, tx?)`, `ctx.requirePermission(key)` (preHandler, 403), `ctx.errors.*`. Harmadik féltől származó csomagot a modul a
gyökér `node_modules`-ból ér el (a `.npmrc` `shamefully-hoist`); új függőséget a modul nem vesz fel. Nehéz csomagot
(`googleapis`, `sharp`, `pdfmake`) a hookon belül dinamikus `import()`-tal érdemes betölteni.

Az új esemény a közös `events` táblába kerül; egy trigger `NOTIFY`-t küld, és a `GET /api/stream` SSE-folyamon minden
nyitott kliens megkapja.

### Jogosultság és terepes-szűrés

- Szerepkörök: `admin` (minden + beállítások), `iroda` (minden projekt), `terepes` (csak a hozzá rendelt projektek).
  A hozzárendelés a mag `project_members` táblája (`PUT/DELETE /api/projects/:id/members/:userId`).
- Minden projekthez kötött végpont a `ctx.requireProject(req, id)`-vel kezdjen: nem létező vagy törölt projektre 404,
  nem látható projektre (terepes, nincs hozzárendelve) 403.
- Projekteken átívelő listánál (pl. „Mai kiszállásaim”) a `ctx.visibleProjectIds(req)` adja a látható projekteket
  (`null` = mind).
- Az SSE-folyamon a mag szűr: a terepes csak a hozzá rendelt projektek eseményeit kapja, projekt nélkülit nem.
- Műveletenkénti jogosultság a manifest `permissions` mezőjével és a `ctx.requirePermission(key)`-jel.

### Auditnapló

`ctx.audit(req, { action, entity, entityId, label?, projectId?, data? })`: `action` a `view`, `create`, `update`,
`delete` egyike; az entitás típusa a naplóban `<modul>.<entity>`. A megtekintést (`view`) ugyanarra az entitásra
egy percen belül nem írja újra. Személyes adat megnyitásakor (pl. levél, fájl letöltése) érdemes `view`-t írni. Az
adminfelület a típus nevét a modul `<modul>.audit.<entity>` i18n-kulcsából veszi, ha van ilyen.

## Kliens oldal (`web/index.ts`)

```ts
import type { WebModule } from '@/core/module-types.ts';

export default {
  id: 'example',
  messages,                                         // a web/i18n.ts-ből
  routes: [{ path: '/example', Component: ExamplePage }],
  eventRenderers: { 'example.pinged': PingedEvent }, // eseménytípus → idővonal-megjelenítő
} satisfies WebModule;
```

- Szövegek: `web/i18n.ts`-ben `messages` (minden kulcs `<id>.` előtagú) és `export const t = moduleT(messages)`.
- Eseménymegjelenítő: `EventRendererProps` (`event`, `timeZone`); a `DefaultEvent` (`@/core/DefaultEvent.tsx`) köré
  építhető. Ha egy típusnak nincs megjelenítője, az alapértelmezett látszik.
- Élő frissítés: a mag minden új eseménynél újratölti a projekt eseménylistáját; a modul saját adataihoz a
  `useLiveEvents(handler)` (`@/core/stream.ts`) ad értesítést.
- API-hívás: `request<T>(method, url, body)` (`@/core/api.ts`), a mag hibaformátumával.
- Link a projekt-adatlapon („A projekt oldalai” linksor, csak bekapcsolt modulnál): `projectLinks: [{ labelKey,
  to: (projectId) => '/<útvonal>/' + projectId, Badge? }]`; a feliratkulcs a modul előtagjával, a `Badge` (ha van) a
  felirat mellé kerül (`{ projectId }` propot kap, pl. olvasatlan üzenetek száma).
- Jelvény a menüpont mellett: `menuBadges: { '/<menü-útvonal>': Komponens }` (a kulcs a manifest `menu[].path`-ja; a
  komponens propot nem kap, és semmit nem jelenít meg, ha nincs mit jelezni). Az adatát a modul saját végpontjából veszi.
