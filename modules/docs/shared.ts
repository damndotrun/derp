// A dokumentumtár szerver és kliens közötti adatformái (a szerver ezekkel validál, a kliens a típusokat használja).
import { z } from 'zod';

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'érvénytelen sha256');

const name = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !/[\\/\u0000-\u001f]/.test(s), 'a név nem tartalmazhat perjelet és vezérlőkaraktert');

export const FileName = name;
export const FolderName = name.pipe(z.string().max(200));

export const DocsFile = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  folderId: z.uuid().nullable(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  sha256: Sha256,
  hasThumb: z.boolean(),
  uploadedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  eventId: z.uuid().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type DocsFile = z.infer<typeof DocsFile>;

export const DocsFolder = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type DocsFolder = z.infer<typeof DocsFolder>;

/** Egy projekt dokumentumtára: minden mappa és fájl (a kliens mappánként szűr). */
export const ProjectDocs = z.object({ folders: z.array(DocsFolder), files: z.array(DocsFile) });
export type ProjectDocs = z.infer<typeof ProjectDocs>;

/**
 * Feltöltés: `PUT /api/docs/projects/:projectId/files/:fileId`, a törzs a fájl bájtjai
 * (`Content-Type: application/octet-stream`), a metaadat a lekérdezési paraméterekben.
 */
export const UploadQuery = z.object({
  name: FileName,
  /** A fájl MIME-típusa (a böngésző `File.type`-ja); üresen a kiterjesztésből. */
  type: z.string().max(255).optional(),
  folderId: z.uuid().optional(),
  /** Ha meg van adva, a szerver ellenőrzi; eltérésnél 400 (sérült feltöltés). */
  sha256: Sha256.optional(),
  /** Szülő-esemény (pl. a felmérés eseménye), hogy az idővonalon egy csoportban legyenek. */
  parentEventId: z.uuid().optional(),
});
export type UploadQuery = z.infer<typeof UploadQuery>;

export const FolderCreate = z.object({ name: FolderName, parentId: z.uuid().nullable().optional() });
export type FolderCreate = z.infer<typeof FolderCreate>;

export const FolderUpdate = z.object({ version: z.number().int().positive(), name: FolderName });
export type FolderUpdate = z.infer<typeof FolderUpdate>;

export const FileUpdate = z
  .object({ version: z.number().int().positive(), name: FileName.optional(), folderId: z.uuid().nullable().optional() })
  .refine((v) => v.name !== undefined || v.folderId !== undefined, 'nincs módosítandó mező');
export type FileUpdate = z.infer<typeof FileUpdate>;

export const DOCS_EVENTS = {
  fileUploaded: 'docs.file_uploaded',
  fileDeleted: 'docs.file_deleted',
} as const;

/** A `docs.file_uploaded` és `docs.file_deleted` esemény `data` mezője. */
export interface DocsFileEventData {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  folderId: string | null;
  thumb: boolean;
}

/** Egy feltöltés legnagyobb mérete (a kliens a fotókat előtte 2560 px-re kicsinyíti). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
