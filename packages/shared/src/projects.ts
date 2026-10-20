import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
// Az ügyfél a 2b. munkacsomagig szöveges mező; utána ügyfél-rekord váltja ki migrációval.
const clientName = z.string().trim().max(200);

export const ProjectCreate = z.object({
  name,
  clientName: clientName.default(''),
});
export type ProjectCreate = z.input<typeof ProjectCreate>;

export const ProjectUpdate = z
  .object({
    version: z.number().int().positive(),
    name: name.optional(),
    clientName: clientName.optional(),
  })
  .refine((v) => v.name !== undefined || v.clientName !== undefined, {
    message: 'Legalább egy mezőt módosítani kell',
  });
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

export const Project = z.object({
  id: z.uuid(),
  name: z.string(),
  clientName: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Project = z.infer<typeof Project>;

export const ProjectList = z.object({ items: z.array(Project) });
export type ProjectList = z.infer<typeof ProjectList>;
