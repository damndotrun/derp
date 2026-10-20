import { z } from 'zod';
import { Role } from './roles.ts';

const email = z.string().trim().max(254).pipe(z.email());
const name = z.string().trim().min(1).max(200);

/** Felhasználó az adminfelületen: belépni csak az itt felvett, aktív e-mail-címmel lehet. */
export const UserRecord = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: Role,
  active: z.boolean(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type UserRecord = z.infer<typeof UserRecord>;

export const UserList = z.object({ items: z.array(UserRecord) });
export type UserList = z.infer<typeof UserList>;

export const UserCreate = z.object({ email, name, role: Role });
export type UserCreate = z.infer<typeof UserCreate>;

export const UserUpdate = z
  .object({
    version: z.number().int().positive(),
    email: email.optional(),
    name: name.optional(),
    role: Role.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.email !== undefined || v.name !== undefined || v.role !== undefined || v.active !== undefined, {
    message: 'Legalább egy mezőt módosítani kell',
  });
export type UserUpdate = z.infer<typeof UserUpdate>;
