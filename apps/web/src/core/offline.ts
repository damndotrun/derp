// Terepi mód a böngészőben: a service worker regisztrálása, az offline gyorsítótár előtöltése (a terepesnek) és
// törlése (kilépéskor), a kapcsolat állapota.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { User } from '@derp/shared';
import { API_CACHE, THUMB_CACHE } from '../../sw/routes.ts';
import { api } from './api.ts';
import { registry, modulesKey } from './modules.ts';
import { TIMELINE_PAGE_SIZE } from './Timeline.tsx';

/**
 * A service worker (`/sw.js`, a `pnpm build` teszi a buildbe) regisztrálása; a Vite fejlesztői szerverén nincs. A
 * build módja (`MODE`) számít, nem a `NODE_ENV`: az e2e-szerver `NODE_ENV=test` mellett is a buildet szolgálja ki.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.MODE !== 'production' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => console.warn('A service worker nem regisztrálható', err));
  });
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Van-e hálózat (a böngésző szerint). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false);
}

const hasCaches = () => typeof caches !== 'undefined';

/** Kilépéskor (és más felhasználó belépésekor) a telefonon tárolt API-válaszok törlése. */
export async function clearOfflineCaches(): Promise<void> {
  if (!hasCaches()) return;
  await Promise.all([caches.delete(API_CACHE), caches.delete(THUMB_CACHE)]);
}

/** Előtölti a címeket az API-tárba (ugyanabba, amiből a service worker offline válaszol); a hibát kihagyja. */
export async function warmOfflineCache(urls: string[]): Promise<void> {
  if (!hasCaches() || urls.length === 0) return;
  const cache = await caches.open(API_CACHE);
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) await cache.put(url, res);
    } catch {
      // Offline vagy átmeneti hiba: a következő alkalommal újra.
    }
  }
}

/** A terepi gyorsítótárban tartott projektek legfeljebb ennyien lehetnek (a terepesnek ennyi hozzárendelt projekt bőven elég). */
export const WARM_PROJECT_LIMIT = 30;

/**
 * Az offline is elérendő címek: a munkamenet, a modulok, a projektlista, a látható projektek adatlapja, idővonala
 * és kollégái, valamint a bekapcsolt modulok `offlineUrls` szerinti címei.
 */
export function offlineUrls(projectIds: string[], enabledModules: string[]): string[] {
  const modules = registry.modules.filter((m) => enabledModules.includes(m.id) && m.offlineUrls);
  const urls = ['/api/session', '/api/modules', '/api/projects', ...modules.flatMap((m) => m.offlineUrls!.global ?? [])];
  for (const id of projectIds.slice(0, WARM_PROJECT_LIMIT)) {
    urls.push(`/api/projects/${id}`, `/api/projects/${id}/members`, `/api/projects/${id}/events?limit=${TIMELINE_PAGE_SIZE}`, `/api/projects/${id}/event-types`);
    for (const m of modules) urls.push(...(m.offlineUrls!.project?.(id) ?? []));
  }
  return urls;
}

/**
 * A terepes belépésekor (és amikor újra van hálózat) a „Mai kiszállásaim” és a hozzárendelt projektek adatai a
 * telefonra kerülnek, így térerő nélkül is megnyílnak. Az irodai szerepköröknél nincs előtöltés (minden projektet
 * látnak); náluk csak a már megnyitott oldalak vannak a tárban.
 */
export function useOfflineWarmup(user: User): void {
  const modules = useQuery({ queryKey: modulesKey, queryFn: api.modules, staleTime: 5 * 60_000 });
  const enabled = modules.data?.items.map((m) => m.id).join(',');
  useEffect(() => {
    if (user.role !== 'terepes' || enabled === undefined || !hasCaches()) return;
    let cancelled = false;
    const warm = async () => {
      if (navigator.onLine === false) return;
      try {
        const projects = await api.projects();
        if (!cancelled) await warmOfflineCache(offlineUrls(projects.items.map((p) => p.id), enabled.split(',')));
      } catch {
        // Offline: a következő `online` eseménynél újra.
      }
    };
    void warm();
    window.addEventListener('online', warm);
    return () => {
      cancelled = true;
      window.removeEventListener('online', warm);
    };
  }, [user.id, user.role, enabled]);
}
