import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
const text = (max: number) => z.string().trim().max(max);
const email = z.union([z.literal(''), z.string().trim().pipe(z.email())]);

/** Ügyfél-hivatkozás (projekten, listában). */
export const ClientRef = z.object({ id: z.uuid(), name: z.string() });
export type ClientRef = z.infer<typeof ClientRef>;

export const Client = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string(),
  note: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Client = z.infer<typeof Client>;

export const ClientList = z.object({ items: z.array(Client) });
export type ClientList = z.infer<typeof ClientList>;

export const ClientCreate = z.object({
  name,
  address: text(500).default(''),
  note: text(2000).default(''),
});
export type ClientCreate = z.input<typeof ClientCreate>;

export const ClientUpdate = z
  .object({
    version: z.number().int().positive(),
    name: name.optional(),
    address: text(500).optional(),
    note: text(2000).optional(),
  })
  .refine((v) => v.name !== undefined || v.address !== undefined || v.note !== undefined, {
    message: 'Legalább egy mezőt módosítani kell',
  });
export type ClientUpdate = z.infer<typeof ClientUpdate>;

/** Kapcsolattartó egy ügyfélnél. */
export const Contact = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  name: z.string(),
  position: z.string(),
  phone: z.string(),
  email: z.string(),
  note: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Contact = z.infer<typeof Contact>;

export const ContactCreate = z.object({
  name,
  position: text(200).default(''),
  phone: text(50).default(''),
  email: email.default(''),
  note: text(2000).default(''),
});
export type ContactCreate = z.input<typeof ContactCreate>;

export const ContactUpdate = z
  .object({
    version: z.number().int().positive(),
    name: name.optional(),
    position: text(200).optional(),
    phone: text(50).optional(),
    email: email.optional(),
    note: text(2000).optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), { message: 'Legalább egy mezőt módosítani kell' });
export type ContactUpdate = z.infer<typeof ContactUpdate>;

/** Ügyfél a kapcsolattartóival. */
export const ClientDetail = Client.extend({ contacts: z.array(Contact) });
export type ClientDetail = z.infer<typeof ClientDetail>;
