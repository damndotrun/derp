// A modulok szerver oldali felülete. A modulok ebből csak típust importálnak (`import type`), a futásidejű
// segédeket a `ModuleContext` adja, így a modul kódja nem függ a mag belső fájljaitól.
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { AuditAction, ModuleManifestData, Project } from '@derp/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { HttpError } from './errors.ts';
import type { NewEvent } from './events.ts';

export type { Db } from './db.ts';
export type { NewEvent } from './events.ts';

/** Tranzakción belül a `tx`, különben a `db`. */
export type DbWriter = Pick<Db, 'insert'>;

export interface ModuleAuditEntry {
  action: AuditAction;
  /** A modulon belüli entitás neve (pl. `file`); a naplóban `<modul>.<entity>`. */
  entity: string;
  entityId: string;
  /** Emberi olvasásra: az entitás neve a művelet idején. */
  label?: string;
  projectId?: string | null;
  data?: Record<string, unknown>;
}

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
  /**
   * A projekt, ha létezik, nincs törölve és a felhasználó láthatja. Nem létező vagy törölt projektre 404; ha a
   * felhasználó nem láthatja (terepes, nincs hozzárendelve), 403. Minden projekthez kötött modul-végpont ezzel kezdjen.
   */
  requireProject(req: FastifyRequest, projectId: string): Promise<Project>;
  /**
   * A felhasználó által látható projektek azonosítói; `null`, ha mindet látja (admin, iroda). Projektek közötti
   * listákhoz (pl. „Mai kiszállásaim”, olvasatlan üzenetek) a terepes-szűréshez.
   */
  visibleProjectIds(req: FastifyRequest): Promise<string[] | null>;
  /**
   * Auditnapló-bejegyzés (ki, mikor, mit nézett meg vagy módosított). Az entitás típusa `<modul>.<entity>` lesz.
   * A megtekintést (`view`) percen belül ugyanarra az entitásra nem írja újra.
   */
  audit(req: FastifyRequest, entry: ModuleAuditEntry, tx?: DbWriter): Promise<void>;
  /** preHandler: csak akkor enged tovább, ha a felhasználó szerepköre megkapja a modul jogosultságát (különben 403). */
  requirePermission(key: string): preHandlerAsyncHookHandler;
  /**
   * A kliens oldali időbélyeg (`capturedAt`, pl. offline készült fotó, jegyzet, chat-üzenet) az esemény idejéhez: a
   * jövőbeli időpont helyett a szerver ideje, a 30 napnál régebbi, hiányzó vagy érvénytelen helyett `undefined` (a
   * szerverre érkezés ideje).
   */
  clientTime(capturedAt: string | null | undefined): Date | undefined;
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
