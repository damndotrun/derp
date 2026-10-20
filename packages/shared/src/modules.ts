import { z } from 'zod';
import { Role } from './roles.ts';

/** Modulazonosító: egyben az eseménytípusok előtagja (`<modul>.<esemény>`) és az i18n-kulcsok előtagja. */
export const ModuleId = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** Menüpont a modul manifestjéből; a feliratot a kliens az i18n-kulcsból fordítja. */
export const ModuleMenuItem = z.object({
  /** Kliens oldali útvonal, pl. `/example`. */
  path: z.string().regex(/^\/[a-z0-9/_-]*$/),
  labelKey: z.string(),
  /** Ha meg van adva, csak ezek a szerepkörök látják. */
  roles: z.array(Role).optional(),
});
export type ModuleMenuItem = z.infer<typeof ModuleMenuItem>;

/** Eseménytípus a regiszterben; a megjelenítőt a modul kliens oldali része adja típus szerint. */
export const ModuleEventType = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  labelKey: z.string(),
});
export type ModuleEventType = z.infer<typeof ModuleEventType>;

/** Jogosultság: `<modul>.<művelet>`, és mely szerepkörök kapják meg. */
export const ModulePermission = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  roles: z.array(Role).min(1),
});
export type ModulePermission = z.infer<typeof ModulePermission>;

/** A manifest adatrésze (a szerver oldali hookok nélkül); a `GET /api/modules` ebből ad. */
export const ModuleManifestData = z.object({
  id: ModuleId,
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  dependsOn: z.array(ModuleId).default([]),
  menu: z.array(ModuleMenuItem).default([]),
  eventTypes: z.array(ModuleEventType).default([]),
  permissions: z.array(ModulePermission).default([]),
});
export type ModuleManifestData = z.input<typeof ModuleManifestData>;
export type ResolvedModuleManifestData = z.output<typeof ModuleManifestData>;

/** Egy bekapcsolt modul a bejelentkezett felhasználó szemével (szerepkör szerint szűrt menü, saját jogosultságok). */
export const ModuleInfo = z.object({
  id: ModuleId,
  version: z.string(),
  menu: z.array(ModuleMenuItem.omit({ roles: true })),
  eventTypes: z.array(ModuleEventType),
  permissions: z.array(z.string()),
});
export type ModuleInfo = z.infer<typeof ModuleInfo>;

export const ModuleList = z.object({ items: z.array(ModuleInfo) });
export type ModuleList = z.infer<typeof ModuleList>;
