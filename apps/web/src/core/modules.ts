import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { registerMessages } from './i18n.ts';
import type { EventRenderer, MenuBadge, ModuleRoute, ProjectLink, WebModule } from './module-types.ts';
import { outbox as defaultOutbox, type Outbox } from './outbox.ts';

export type { EventRenderer, EventRendererProps, MenuBadge, ModuleRoute, ProjectLink, WebModule } from './module-types.ts';

export interface ModuleRegistry {
  modules: WebModule[];
  routes: Array<ModuleRoute & { moduleId: string }>;
  eventRenderers: Record<string, EventRenderer>;
  projectLinks: Array<ProjectLink & { moduleId: string }>;
  /** `<modul>:<menü-útvonal>` → jelvény. */
  menuBadges: Map<string, MenuBadge>;
}

const badgeKey = (moduleId: string, path: string) => `${moduleId}:${path}`;

/**
 * Összeállítja a regisztert, és ellenőrzi, hogy minden a modul saját előtagját használja. Az offline sor elemfajtáit
 * a sorba regisztrálja.
 */
export function buildRegistry(modules: WebModule[], outbox: Pick<Outbox, 'register'> = defaultOutbox): ModuleRegistry {
  const registry: ModuleRegistry = { modules, routes: [], eventRenderers: {}, projectLinks: [], menuBadges: new Map() };
  for (const m of modules) {
    registerMessages(m.id, m.messages);
    for (const route of m.routes ?? []) registry.routes.push({ ...route, moduleId: m.id });
    for (const [type, renderer] of Object.entries(m.eventRenderers ?? {})) {
      if (!type.startsWith(`${m.id}.`)) throw new Error(`A(z) „${m.id}” modul idegen eseménytípust jelenítene meg: ${type}`);
      registry.eventRenderers[type] = renderer;
    }
    for (const link of m.projectLinks ?? []) {
      if (!link.labelKey.startsWith(`${m.id}.`)) throw new Error(`A(z) „${m.id}” modul projektlinkje idegen feliratkulcsot használ: ${link.labelKey}`);
      registry.projectLinks.push({ ...link, moduleId: m.id });
    }
    for (const [path, badge] of Object.entries(m.menuBadges ?? {})) registry.menuBadges.set(badgeKey(m.id, path), badge);
    for (const [kind, handler] of Object.entries(m.outbox ?? {})) {
      if (!kind.startsWith(`${m.id}.`)) throw new Error(`A(z) „${m.id}” modul idegen elemfajtát küldene az offline sorból: ${kind}`);
      outbox.register(kind, handler);
    }
  }
  return registry;
}

// Modulfelfedezés könyvtár-bejárással: minden `modules/*/web/index.ts` bekerül a buildbe; hogy melyik látszik,
// azt a szerver mondja meg (`DERP_MODULES` → `GET /api/modules`).
const found = import.meta.glob<{ default: WebModule }>('../../../../modules/*/web/index.ts', { eager: true });
export const registry = buildRegistry(Object.values(found).map((m) => m.default));

export const modulesKey = ['modules'] as const;

export const menuBadgeFor = (moduleId: string, path: string): MenuBadge | undefined =>
  registry.menuBadges.get(badgeKey(moduleId, path));

/** A bekapcsolt modulok (a bejelentkezett felhasználó szerepköre szerint szűrt menüvel). */
export function useModules() {
  return useQuery({ queryKey: modulesKey, queryFn: api.modules, staleTime: 5 * 60_000 });
}

/** A bekapcsolt modulok projekt-adatlapi linkjei, a `GET /api/modules` sorrendjében. */
export function useProjectLinks(): Array<ProjectLink & { moduleId: string }> {
  const modules = useModules();
  return (modules.data?.items ?? []).flatMap((m) => registry.projectLinks.filter((l) => l.moduleId === m.id));
}
