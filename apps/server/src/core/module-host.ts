import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { ModuleList, type ModuleInfo, type User } from '@derp/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { visibleProjectIds } from './access.ts';
import { recordView, writeAudit } from './audit.ts';
import { clientTime } from './client-time.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from './errors.ts';
import { appendEvent } from './events.ts';
import type { ModuleContext, ModuleSeedContext } from './module-api.ts';
import type { LoadedModule } from './modules.ts';
import { getVisibleProject, toProjectDto } from './projects.ts';

export function createSeedContext(m: LoadedModule, db: Db, pool: pg.Pool): ModuleSeedContext {
  const { id, eventTypes } = m.manifest;
  const declared = new Set(eventTypes.map((e) => e.type));
  return {
    id,
    db,
    pool,
    appendEvent: async (e, tx) => {
      // Programozási hiba, ha a modul nem a saját, manifestben felvett típusával ír.
      if (!declared.has(e.type)) throw new Error(`A(z) „${id}” modul manifestjében nincs ilyen eseménytípus: ${e.type}`);
      return appendEvent(tx ?? db, e);
    },
  };
}

export function createModuleContext(m: LoadedModule, db: Db, pool: pg.Pool, config: Config): ModuleContext {
  const permissions = new Map(m.manifest.permissions.map((p) => [p.key, p.roles]));
  return {
    ...createSeedContext(m, db, pool),
    config,
    requireProject: async (req, projectId) => {
      if (!req.user) throw unauthorized();
      return toProjectDto(await getVisibleProject(db, req.user, projectId));
    },
    visibleProjectIds: async (req) => {
      if (!req.user) throw unauthorized();
      return visibleProjectIds(db, req.user);
    },
    audit: async (req, entry, tx) => {
      const entityType = `${m.manifest.id}.${entry.entity}`;
      const e = { userId: req.user?.id ?? null, entityType, entityId: entry.entityId, label: entry.label, projectId: entry.projectId, data: entry.data };
      if (entry.action === 'view' && !tx) await recordView(db, e);
      else await writeAudit(tx ?? db, { ...e, action: entry.action });
    },
    requirePermission: (key) => {
      const roles = permissions.get(key);
      if (!roles) throw new Error(`A(z) „${m.manifest.id}” modul manifestjében nincs ilyen jogosultság: ${key}`);
      return async (req) => {
        if (!req.user || !roles.includes(req.user.role)) throw forbidden();
      };
    },
    clientTime: (capturedAt) => clientTime(capturedAt),
    errors: {
      badRequest,
      notFound,
      forbidden,
      conflict,
    },
  };
}

/** Egy modul a felhasználó szerepköre szerint: a neki szóló menüpontok és a megkapott jogosultságok. */
export function moduleInfoFor(m: LoadedModule, user: User): ModuleInfo {
  const { id, version, menu, eventTypes, permissions } = m.manifest;
  return {
    id,
    version,
    menu: menu.filter((i) => !i.roles || i.roles.includes(user.role)).map(({ path, labelKey }) => ({ path, labelKey })),
    eventTypes,
    permissions: permissions.filter((p) => p.roles.includes(user.role)).map((p) => p.key),
  };
}

export async function moduleListRoutes(app: FastifyInstance, opts: { modules: LoadedModule[] }): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get('/api/modules', { schema: { response: { 200: ModuleList } } }, async (req) => ({
    items: opts.modules.map((m) => moduleInfoFor(m, req.user!)),
  }));
}

/** A bekapcsolt modulok `seedE2E` hookjai függőségi sorrendben (a mag felhasználói után). */
export async function seedModules(modules: LoadedModule[], db: Db, pool: pg.Pool): Promise<void> {
  for (const m of modules) await m.manifest.seedE2E?.(createSeedContext(m, db, pool));
}
