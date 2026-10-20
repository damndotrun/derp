// A modulok szerver oldali felülete. A modulok ebből csak típust importálnak (`import type`), a futásidejű
// segédeket a `ModuleContext` adja, így a modul kódja nem függ a mag belső fájljaitól.
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { ModuleManifestData, Project } from '@derp/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { HttpError } from './errors.ts';
import type { NewEvent } from './events.ts';

export type { Db } from './db.ts';
export type { NewEvent } from './events.ts';

/** Tranzakción belül a `tx`, különben a `db`. */
export type DbWriter = Pick<Db, 'insert'>;

/** A `seedE2E` hook környezete (a CLI-ből is fut, ezért nincs benne a teljes konfiguráció). */
export interface ModuleSeedContext {
  /** A modul azonosítója. */
  id: string;
  db: Db;
  pool: pg.Pool;
  /** Esemény a közös naplóba; csak a modul manifestjében felvett típussal. */
  appendEvent(e: NewEvent, tx?: DbWriter): Promise<string>;
}

/** A modul útvonalainak környezete. */
export interface ModuleContext extends ModuleSeedContext {
  config: Config;
  /** A projekt, ha létezik, nincs törölve és a felhasználó láthatja; különben 404. */
  requireProject(req: FastifyRequest, projectId: string): Promise<Project>;
  /** preHandler: csak akkor enged tovább, ha a felhasználó szerepköre megkapja a modul jogosultságát (különben 403). */
  requirePermission(key: string): preHandlerAsyncHookHandler;
  /** Hibák a mag egységes hibaformátumában (`{ error: { code, message } }`). */
  errors: {
    badRequest(message: string): HttpError;
    notFound(message?: string): HttpError;
    forbidden(message?: string): HttpError;
    conflict(message: string): HttpError;
  };
}

/**
 * Egy modul leírója (`modules/<id>/manifest.ts`, alapértelmezett export). Az adatrész (azonosító, verzió,
 * függőségek, menüpontok, eseménytípusok, jogosultságok) a `GET /api/modules` válaszába kerül; a hookok csak a
 * szerveren futnak. A migrációk helye `modules/<id>/migrations/*.sql`, a kliens oldali rész (oldalak,
 * eseménymegjelenítők, i18n) a `modules/<id>/web/index.ts`.
 *
 * Nehéz függőséget (pl. `googleapis`, `sharp`) a hookon belül, dinamikus `import()`-tal érdemes betölteni, hogy a
 * kikapcsolt modul ne foglaljon memóriát.
 */
export interface ModuleManifest extends ModuleManifestData {
  /** Bejelentkezést igénylő útvonalak (a mag `requireUser` preHandlere alatt). */
  routes?: (app: FastifyInstance, ctx: ModuleContext) => Promise<void>;
  /** Belépés nélkül elérhető útvonalak (pl. tokenes ICS-feed); a védelem a modul dolga. */
  publicRoutes?: (app: FastifyInstance, ctx: ModuleContext) => Promise<void>;
  /** E2E tesztadatok; a `pnpm seed:e2e` a mag felhasználói után, függőségi sorrendben hívja. Többször is futhat. */
  seedE2E?: (ctx: ModuleSeedContext) => Promise<void>;
}
