import { z } from 'zod';

// A `visits` modul API-sémái (szerveren validálásra, a kliens csak a típusokat használja).

/** A kiszállás állapota. A spec csak „állapot”-ot ír; ez a négy érték a modul választása (ld. jelentés). */
export const VisitStatus = z.enum(['utemezett', 'folyamatban', 'kesz', 'elmaradt']);
export type VisitStatus = z.infer<typeof VisitStatus>;

const isoDateTime = z.iso.datetime({ offset: true });
export const LocalDate = z.iso.date();

export const VisitAssignee = z.object({ id: z.uuid(), name: z.string() });
export type VisitAssignee = z.infer<typeof VisitAssignee>;

/** Ugyanannak a kollégának egy másik, időben átfedő kiszállása. */
export const VisitConflict = z.object({
  visitId: z.uuid(),
  userId: z.uuid(),
  userName: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  /** `null`, ha a kérdező nem láthatja azt a projektet. */
  projectName: z.string().nullable(),
});
export type VisitConflict = z.infer<typeof VisitConflict>;

export const Visit = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string(),
  clientName: z.string().nullable(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  address: z.string(),
  task: z.string(),
  status: VisitStatus,
  version: z.number().int(),
  assignees: z.array(VisitAssignee),
  conflicts: z.array(VisitConflict),
});
export type Visit = z.infer<typeof Visit>;

export const VisitList = z.object({ items: z.array(Visit) });
export type VisitList = z.infer<typeof VisitList>;

const assigneeIds = z
  .array(z.uuid())
  .min(1, 'Legalább egy kollégát meg kell adni')
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Egy kolléga csak egyszer szerepelhet');
const address = z.string().trim().max(500);
const task = z.string().trim().max(4000);

export const VisitCreate = z
  .object({
    projectId: z.uuid(),
    assigneeIds,
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    address: address.default(''),
    task: task.default(''),
    status: VisitStatus.default('utemezett'),
  })
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), { message: 'A vége a kezdés után legyen', path: ['endsAt'] });
export type VisitCreate = z.input<typeof VisitCreate>;

export const VisitUpdate = z
  .object({
    version: z.number().int().positive(),
    assigneeIds: assigneeIds.optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    address: address.optional(),
    task: task.optional(),
    status: VisitStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: 'Legalább egy mezőt módosítani kell' });
export type VisitUpdate = z.input<typeof VisitUpdate>;

/** A napi/heti nézet lekérdezése: a `[from, to)` időszakkal átfedő kiszállások, opcionálisan egy kollégáé. */
export const VisitListQuery = z
  .object({ from: isoDateTime, to: isoDateTime, userId: z.uuid().optional() })
  .refine((q) => new Date(q.from) < new Date(q.to), { message: 'A „from” a „to” előtt legyen', path: ['to'] })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= 62 * 86_400_000, {
    message: 'Legfeljebb 62 napos időszak kérhető',
    path: ['to'],
  });

/** „Mai kiszállásaim”: `date` = helyi naptári nap (`YYYY-MM-DD`), alapból a mai nap a TZ_DISPLAY szerint. */
export const MineQuery = z.object({ date: LocalDate.optional() });

export const MineResponse = z.object({ date: LocalDate, items: z.array(Visit) });
export type MineResponse = z.infer<typeof MineResponse>;

/** A saját ICS-feed állapota; a tokent a szerver csak hash-elve tárolja, ezért a link csak létrehozáskor látszik. */
export const IcsTokenInfo = z.object({ exists: z.boolean(), createdAt: isoDateTime.nullable() });
export type IcsTokenInfo = z.infer<typeof IcsTokenInfo>;

export const IcsTokenCreated = z.object({ url: z.url(), createdAt: isoDateTime });
export type IcsTokenCreated = z.infer<typeof IcsTokenCreated>;

/** Az idővonal-események adatrésze (`visits.scheduled`, `visits.updated`, `visits.cancelled`). */
export interface VisitEventData {
  visitId: string;
  startsAt: string;
  endsAt: string;
  address: string;
  task: string;
  status: VisitStatus;
  assignees: VisitAssignee[];
  /** Módosításnál a megváltozott mezők nevei. */
  changed?: string[];
}

export const VISIT_EVENTS = {
  scheduled: 'visits.scheduled',
  updated: 'visits.updated',
  cancelled: 'visits.cancelled',
} as const;
