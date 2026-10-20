import { z } from 'zod';

/** Az auditnapló műveletei: megtekintés, létrehozás, módosítás, törlés, belépés. */
export const AuditAction = z.enum(['view', 'create', 'update', 'delete', 'login']);
export type AuditAction = z.infer<typeof AuditAction>;

/** A mag entitásai; a modulok saját típust is írhatnak (`<modul>.<entitás>`). */
export const AuditEntityType = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/);

export const AuditEntry = z.object({
  id: z.number().int(),
  at: z.iso.datetime({ offset: true }),
  user: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  action: AuditAction,
  entityType: z.string(),
  entityId: z.string(),
  /** Az entitás neve a művelet idején (pl. a projekt neve). */
  label: z.string(),
  projectId: z.uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditList = z.object({
  items: z.array(AuditEntry),
  /** A következő oldal `before` értéke; `null`, ha nincs több. */
  nextBefore: z.number().int().nullable(),
});
export type AuditList = z.infer<typeof AuditList>;

export const AuditQuery = z.object({
  userId: z.uuid().optional(),
  entityType: AuditEntityType.optional(),
  entityId: z.string().max(100).optional(),
  projectId: z.uuid().optional(),
  action: AuditAction.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof AuditQuery>;
