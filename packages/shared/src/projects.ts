import { z } from 'zod';
import { ClientRef } from './clients.ts';
import { Role } from './roles.ts';

const name = z.string().trim().min(1).max(200);

export const ProjectCreate = z.object({
  name,
  clientId: z.uuid().nullable().default(null),
});
export type ProjectCreate = z.input<typeof ProjectCreate>;

export const ProjectUpdate = z
  .object({
    version: z.number().int().positive(),
    name: name.optional(),
    clientId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.clientId !== undefined, {
    message: 'Legalább egy mezőt módosítani kell',
  });
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

export const Project = z.object({
  id: z.uuid(),
  name: z.string(),
  client: ClientRef.nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Project = z.infer<typeof Project>;

export const ProjectList = z.object({ items: z.array(Project) });
export type ProjectList = z.infer<typeof ProjectList>;

export const ProjectListQuery = z.object({ clientId: z.uuid().optional() });

/** A projekthez rendelt kolléga (a terepes felhasználó csak a hozzá rendelt projekteket látja). */
export const ProjectMember = z.object({ id: z.uuid(), name: z.string(), role: Role });
export type ProjectMember = z.infer<typeof ProjectMember>;

export const ProjectMemberList = z.object({ items: z.array(ProjectMember) });
export type ProjectMemberList = z.infer<typeof ProjectMemberList>;
