import { z } from 'zod';

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL kötelező'),
    SESSION_SECRET: z
      .string({ error: 'SESSION_SECRET kötelező' })
      .refine((s) => Buffer.byteLength(s, 'utf8') >= 32, 'SESSION_SECRET legalább 32 bájt legyen'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
    DEV_LOGIN: z.enum(['0', '1']).default('0'),
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
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEV_LOGIN === '1'), {
    message: 'DEV_LOGIN=1 nem használható NODE_ENV=production mellett',
    path: ['DEV_LOGIN'],
  });

export interface Config {
  databaseUrl: string;
  sessionSecret: string;
  publicBaseUrl: string;
  devLogin: boolean;
  nodeEnv: 'production' | 'development' | 'test';
  tzDisplay: string;
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
  };
}
