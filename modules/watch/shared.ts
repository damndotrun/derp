// A mappafigyelő szerver és kliens közötti adatformái (a szerver ezekkel validál, a kliens a típusokat használja).
import { z } from 'zod';

/**
 * Relatív útvonal a figyelt gyökér alatt, `/`-rel elválasztva: nem üres szakaszok, `.` és `..` nélkül, vezérlőkarakter
 * és visszaperjel nélkül. A kezdő és záró perjelet levágja.
 */
export const RelPath = z
  .string()
  .trim()
  .transform((s) => s.replace(/^\/+|\/+$/g, ''))
  .pipe(
    z
      .string()
      .min(1, 'adj meg egy almappát')
      .max(1000)
      .refine((s) => !/[\\\u0000-\u001f]/.test(s), 'az útvonal nem tartalmazhat visszaperjelet és vezérlőkaraktert')
      .refine((s) => s.split('/').every((p) => p !== '' && p !== '.' && p !== '..'), 'érvénytelen útvonal'),
  );

export const WatchMapping = z.object({
  projectId: z.uuid(),
  /** Az almappa a figyelt gyökérhez (`WATCH_ROOT`) képest. */
  path: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Az utolsó sikeres bejárás ideje. */
  lastScanAt: z.iso.datetime({ offset: true }).nullable(),
  /** Ha az utolsó bejárás nem sikerült (pl. a mappa nem érhető el): a hiba szövege. Ilyenkor nem keletkezik esemény. */
  lastError: z.string().nullable(),
  fileCount: z.number().int(),
});
export type WatchMapping = z.infer<typeof WatchMapping>;

export const WatchFile = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** A hozzárendelt almappához képest, `/`-rel. */
  path: z.string(),
  size: z.number().int(),
  mtime: z.iso.datetime({ offset: true }),
});
export type WatchFile = z.infer<typeof WatchFile>;

/** Egy projekt hozzárendelt almappája (ha van) és a benne lévő fájlok útvonal szerint. */
export const ProjectWatch = z.object({ mapping: WatchMapping.nullable(), files: z.array(WatchFile) });
export type ProjectWatch = z.infer<typeof ProjectWatch>;

export const MappingList = z.object({ items: z.array(WatchMapping) });
export type MappingList = z.infer<typeof MappingList>;

/** Hozzárendelés vagy módosítás; meglévő hozzárendelésnél a `version` kötelező (eltérésnél 409). */
export const MappingSet = z.object({ path: RelPath, version: z.number().int().positive().optional() });
export type MappingSet = z.infer<typeof MappingSet>;

/** A figyelt gyökér egy könyvtárának almappái (a hozzárendeléshez). */
export const FolderList = z.object({
  /** Az aktuális könyvtár a gyökérhez képest (`''` = a gyökér). */
  path: z.string(),
  folders: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      /** Ha már egy projekthez tartozik. */
      project: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    }),
  ),
});
export type FolderList = z.infer<typeof FolderList>;

export const FolderQuery = z.object({ path: z.string().max(1000).optional() });

/** Egy bejárás eredménye. Ha `error` nem `null`, a bejárás nem futott le, és nem keletkezett esemény. */
export const ScanResult = z.object({
  added: z.number().int(),
  modified: z.number().int(),
  deleted: z.number().int(),
  renamed: z.number().int(),
  files: z.number().int(),
  error: z.string().nullable(),
});
export type ScanResult = z.infer<typeof ScanResult>;

/** Teszt-végpont (`NODE_ENV=test`): fájl írása a `WATCH_ROOT` alá. */
export const TestWatchFile = z.object({
  path: RelPath,
  content: z.string().max(10 * 1024 * 1024),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
});
export type TestWatchFile = z.infer<typeof TestWatchFile>;

export const WATCH_EVENTS = {
  fileAdded: 'watch.file_added',
  fileModified: 'watch.file_modified',
  fileDeleted: 'watch.file_deleted',
  fileRenamed: 'watch.file_renamed',
} as const;

/** A `watch.*` események `data` mezője. */
export interface WatchFileEventData {
  fileId: string;
  /** A hozzárendelt almappához képest. */
  path: string;
  name: string;
  size: number;
  mtime: string;
  /** Csak átnevezésnél: a korábbi útvonal. */
  oldPath?: string;
}
