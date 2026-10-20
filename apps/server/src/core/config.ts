import { z } from 'zod';
import { ModuleId } from '@derp/shared';
import type { ModuleSelection } from './modules.ts';

/** `DERP_MODULES`: `*` = minden modul, üres = egyik sem, különben vesszővel elválasztott azonosítók. */
export const DerpModules = z
  .string()
  .default('*')
  .transform((v, ctx): ModuleSelection => {
    if (v.trim() === '*') return '*';
    const ids = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) {
      if (!ModuleId.safeParse(id).success) ctx.addIssue({ code: 'custom', message: `érvénytelen modulazonosító: „${id}”` });
    }
    return ids;
  });

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL kötelező'),
    SESSION_SECRET: z
      .string({ error: 'SESSION_SECRET kötelező' })
      .refine((s) => Buffer.byteLength(s, 'utf8') >= 32, 'SESSION_SECRET legalább 32 bájt legyen'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
    DEV_LOGIN: z.enum(['0', '1']).default('0'),
    DERP_MODULES: DerpModules,
    // A konténeren belül mindig 8080; a második e2e-szerver (kikapcsolt modulokkal) miatt állítható.
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
    TZ_DISPLAY: z
      .string()
      .default('Europe/Budapest')
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('hu-HU', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'TZ_DISPLAY nem érvényes IANA időzóna'),
    // Google-belépés (OpenID Connect); élesítés a 13. munkacsomagban. Ha nincs megadva, csak a dev-login él.
    GOOGLE_LOGIN_CLIENT_ID: z.string().trim().optional(),
    GOOGLE_LOGIN_CLIENT_SECRET: z.string().trim().optional(),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEV_LOGIN === '1'), {
    message: 'DEV_LOGIN=1 nem használható NODE_ENV=production mellett',
    path: ['DEV_LOGIN'],
  })
  .refine((env) => !env.GOOGLE_LOGIN_CLIENT_ID === !env.GOOGLE_LOGIN_CLIENT_SECRET, {
    message: 'a GOOGLE_LOGIN_CLIENT_ID és a GOOGLE_LOGIN_CLIENT_SECRET csak együtt adható meg',
    path: ['GOOGLE_LOGIN_CLIENT_ID'],
  });

export interface Config {
  databaseUrl: string;
  sessionSecret: string;
  publicBaseUrl: string;
  devLogin: boolean;
  nodeEnv: 'production' | 'development' | 'test';
  tzDisplay: string;
  modules: ModuleSelection;
  port: number;
  /** A Google-belépés OAuth-kliense; `null`, ha nincs beállítva. */
  googleLogin: { clientId: string; clientSecret: string } | null;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new ConfigError(`Hibás konfiguráció:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ''),
    devLogin: e.DEV_LOGIN === '1',
    nodeEnv: e.NODE_ENV,
    tzDisplay: e.TZ_DISPLAY,
    modules: e.DERP_MODULES,
    port: e.PORT,
    googleLogin:
      e.GOOGLE_LOGIN_CLIENT_ID && e.GOOGLE_LOGIN_CLIENT_SECRET
        ? { clientId: e.GOOGLE_LOGIN_CLIENT_ID, clientSecret: e.GOOGLE_LOGIN_CLIENT_SECRET }
        : null,
  };
}
