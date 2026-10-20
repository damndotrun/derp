/// <reference lib="webworker" />
// A terepi mód service workere (8. munkacsomag). A kliens buildje után a `scripts/build-sw.ts` fordítja és teszi bele
// az előre gyorsítótárazandó fájlok listáját (`self.__WB_MANIFEST`).
//
// - Az alkalmazás fájljai (HTML, JS, CSS, ikonok) előre a gyorsítótárba kerülnek, így térerő nélkül is megnyílik.
// - Oldalbetöltés: előbb a hálózat (így a Cloudflare Access átirányítása is működik), ha nincs, a tárolt index.html.
// - Az API olvasó (GET) kérései: előbb a hálózat, ha nincs, a legutóbbi sikeres válasz („Mai kiszállásaim”, a
//   hozzárendelt projektek, a chat, a jegyzetek, a dokumentumtár listája). Az élő folyam, a belépés, a letöltések és
//   a teszt-végpontok kimaradnak. A bélyegképek a fájlazonosítóhoz kötöttek (nem változnak), ezért előbb a tárból.
// - A küldés (PUT/POST) nem megy át rajta: az offline sor a kliensben, IndexedDB-ben van (`src/core/outbox.ts`).
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import type { WorkboxPlugin } from 'workbox-core/types.js';
import { API_CACHE, isCachedApi, isThumb, THUMB_CACHE } from './routes.ts';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

/** Csak a sikeres, saját originről jövő válasz kerül a tárba (a 401, a 403 és az átirányítás nem). */
const onlyOk: WorkboxPlugin = {
  cacheWillUpdate: async ({ response }) => (response.status === 200 && response.type === 'basic' ? response : null),
};

const NAVIGATION_TIMEOUT_MS = 4_000;

registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
        try {
          return await fetch(request, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return (await matchPrecache('/index.html')) ?? Response.error();
      }
    },
    { denylist: [/^\/api\//, /^\/adatvedelem/] },
  ),
);

registerRoute(
  ({ url, request, sameOrigin }) => sameOrigin && request.method === 'GET' && isThumb(url.pathname),
  new CacheFirst({ cacheName: THUMB_CACHE, plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 })] }),
);

registerRoute(
  ({ url, request, sameOrigin }) => sameOrigin && request.method === 'GET' && isCachedApi(url.pathname),
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 6,
    plugins: [onlyOk, new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);
