import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ModuleManifestData, type ResolvedModuleManifestData } from '@derp/shared';
import type { MigrationSource } from './migrate.ts';
import type { ModuleManifest } from './module-api.ts';

export const MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

/** A `DERP_MODULES` értéke: `*` = minden modul, különben a felsorolt azonosítók. */
export type ModuleSelection = '*' | string[];

export interface LoadedModule {
  /** A manifest, az adatrész alapértékeivel kiegészítve. */
  manifest: ModuleManifest & ResolvedModuleManifestData;
  dir: string;
  migrations: MigrationSource | null;
}

export class ModuleError extends Error {}

const RESERVED_IDS = new Set(['core']);

/** Beolvassa a `modules/*\/manifest.ts` fájlokat, és ellenőrzi őket (a bekapcsolástól függetlenül). */
export async function discoverModules(dir: string = MODULES_DIR): Promise<LoadedModule[]> {
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const found: LoadedModule[] = [];
  for (const name of entries.sort()) {
    const manifestPath = join(dir, name, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    const mod = (await import(pathToFileURL(manifestPath).href)) as { default?: ModuleManifest };
    if (!mod.default) throw new ModuleError(`${name}/manifest.ts: nincs alapértelmezett export`);
    found.push(validate(name, mod.default, join(dir, name)));
  }
  return found;
}

function validate(dirName: string, raw: ModuleManifest, dir: string): LoadedModule {
  const parsed = ModuleManifestData.safeParse(raw);
  const where = `modules/${dirName}/manifest.ts`;
  if (!parsed.success) {
    throw new ModuleError(`${where}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const data = parsed.data;
  if (data.id !== dirName) throw new ModuleError(`${where}: az id (${data.id}) nem egyezik a könyvtárnévvel`);
  if (RESERVED_IDS.has(data.id)) throw new ModuleError(`${where}: a(z) „${data.id}” azonosító foglalt`);
  const prefix = `${data.id}.`;
  const foreign = [
    ...data.eventTypes.map((e) => e.type),
    ...data.eventTypes.map((e) => e.labelKey),
    ...data.permissions.map((p) => p.key),
    ...data.menu.map((m) => m.labelKey),
  ].filter((k) => !k.startsWith(prefix));
  if (foreign.length) {
    throw new ModuleError(`${where}: az eseménytípus, jogosultság és i18n-kulcs „${prefix}” előtagú legyen: ${foreign.join(', ')}`);
  }
  const migrationsDir = join(dir, 'migrations');
  return {
    manifest: { ...raw, ...data },
    dir,
    migrations: existsSync(migrationsDir) ? { scope: data.id, dir: migrationsDir } : null,
  };
}

/**
 * A `DERP_MODULES` szerint kiválasztja a bekapcsolt modulokat, és függőségi sorrendbe rakja őket (azonos szinten
 * azonosító szerint). Hiba, ha ismeretlen modul van a listában, ha egy bekapcsolt modul függősége nincs bekapcsolva,
 * ha körkörös a függőség, vagy ha két modul ugyanazt a menü-útvonalat adná.
 */
export function selectModules(all: LoadedModule[], selection: ModuleSelection): LoadedModule[] {
  const byId = new Map(all.map((m) => [m.manifest.id, m]));
  let enabled: LoadedModule[];
  if (selection === '*') {
    enabled = all;
  } else {
    const unknown = selection.filter((id) => !byId.has(id));
    if (unknown.length) throw new ModuleError(`DERP_MODULES: ismeretlen modul: ${unknown.join(', ')}`);
    enabled = [...new Set(selection)].map((id) => byId.get(id)!);
  }
  const enabledIds = new Set(enabled.map((m) => m.manifest.id));
  for (const m of enabled) {
    const missing = m.manifest.dependsOn.filter((d) => !enabledIds.has(d));
    if (missing.length) {
      throw new ModuleError(`A(z) „${m.manifest.id}” modulhoz ezek is kellenek a DERP_MODULES-ban: ${missing.join(', ')}`);
    }
  }

  const ordered: LoadedModule[] = [];
  const done = new Set<string>();
  let pending = [...enabled].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  while (pending.length) {
    const ready = pending.filter((m) => m.manifest.dependsOn.every((d) => done.has(d)));
    if (!ready.length) {
      throw new ModuleError(`Körkörös modulfüggőség: ${pending.map((m) => m.manifest.id).join(', ')}`);
    }
    for (const m of ready) {
      ordered.push(m);
      done.add(m.manifest.id);
    }
    pending = pending.filter((m) => !done.has(m.manifest.id));
  }

  const paths = new Map<string, string>();
  for (const m of ordered) {
    for (const item of m.manifest.menu) {
      const other = paths.get(item.path);
      if (other) throw new ModuleError(`A(z) ${item.path} menü-útvonalat két modul is adja: ${other}, ${m.manifest.id}`);
      paths.set(item.path, m.manifest.id);
    }
  }
  return ordered;
}

export async function loadModules(selection: ModuleSelection, dir: string = MODULES_DIR): Promise<LoadedModule[]> {
  return selectModules(await discoverModules(dir), selection);
}

/** A migrációs források a futtatás sorrendjében: a mag, majd a bekapcsolt modulok függőségi sorrendben. */
export function migrationSources(core: MigrationSource, modules: LoadedModule[]): MigrationSource[] {
  return [core, ...modules.flatMap((m) => (m.migrations ? [m.migrations] : []))];
}
