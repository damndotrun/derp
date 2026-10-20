import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { registerMessages } from './i18n.ts';
import type { EventRenderer, ModuleRoute, WebModule } from './module-types.ts';

export type { EventRenderer, EventRendererProps, ModuleRoute, WebModule } from './module-types.ts';

export interface ModuleRegistry {
  modules: WebModule[];
  routes: Array<ModuleRoute & { moduleId: string }>;
  eventRenderers: Record<string, EventRenderer>;
}

/** Összeállítja a regisztert, és ellenőrzi, hogy minden a modul saját előtagját használja. */
export function buildRegistry(modules: WebModule[]): ModuleRegistry {
  const registry: ModuleRegistry = { modules, routes: [], eventRenderers: {} };
  for (const m of modules) {
    registerMessages(m.id, m.messages);
    for (const route of m.routes ?? []) registry.routes.push({ ...route, moduleId: m.id });
    for (const [type, renderer] of Object.entries(m.eventRenderers ?? {})) {
      if (!type.startsWith(`${m.id}.`)) throw new Error(`A(z) „${m.id}” modul idegen eseménytípust jelenítene meg: ${type}`);
      registry.eventRenderers[type] = renderer;
    }
  }
  return registry;
}

// Modulfelfedezés könyvtár-bejárással: minden `modules/*/web/index.ts` bekerül a buildbe; hogy melyik látszik,
// azt a szerver mondja meg (`DERP_MODULES` → `GET /api/modules`).
const found = import.meta.glob<{ default: WebModule }>('../../../../modules/*/web/index.ts', { eager: true });
export const registry = buildRegistry(Object.values(found).map((m) => m.default));

export const modulesKey = ['modules'] as const;

/** A bekapcsolt modulok (a bejelentkezett felhasználó szerepköre szerint szűrt menüvel). */
export function useModules() {
  return useQuery({ queryKey: modulesKey, queryFn: api.modules, staleTime: 5 * 60_000 });
}
