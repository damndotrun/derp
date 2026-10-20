import { z } from 'zod';
import { User } from './roles.ts';

export const DevLoginBody = z.object({ email: z.email() });

export const SessionInfo = z.object({
  user: User.nullable(),
  devLogin: z.boolean(),
  tzDisplay: z.string(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;
