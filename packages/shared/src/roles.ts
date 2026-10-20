import { z } from 'zod';

export const Role = z.enum(['admin', 'iroda', 'terepes']);
export type Role = z.infer<typeof Role>;

export const User = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: Role,
});
export type User = z.infer<typeof User>;
