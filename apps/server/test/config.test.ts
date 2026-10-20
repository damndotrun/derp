import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/core/config.ts';

const base = { DATABASE_URL: 'postgres://x', SESSION_SECRET: 's'.repeat(32) };

describe('loadConfig', () => {
  it('a spec szerinti alapértékeket adja', () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: 'postgres://x',
      sessionSecret: 's'.repeat(32),
      publicBaseUrl: 'http://localhost:8080',
      devLogin: false,
      nodeEnv: 'production',
      tzDisplay: 'Europe/Budapest',
      modules: '*',
      port: 8080,
    });
  });

  it('DERP_MODULES: `*`, üres vagy vesszős lista', () => {
    expect(loadConfig({ ...base, DERP_MODULES: ' * ' }).modules).toBe('*');
    expect(loadConfig({ ...base, DERP_MODULES: '' }).modules).toEqual([]);
    expect(loadConfig({ ...base, DERP_MODULES: 'example, docs,,' }).modules).toEqual(['example', 'docs']);
    expect(() => loadConfig({ ...base, DERP_MODULES: 'Example' })).toThrow(/DERP_MODULES/);
  });

  it('DEV_LOGIN=1 mellett production módban nem indul', () => {
    expect(() => loadConfig({ ...base, DEV_LOGIN: '1' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, DEV_LOGIN: '1', NODE_ENV: 'production' })).toThrow(/DEV_LOGIN/);
    expect(loadConfig({ ...base, DEV_LOGIN: '1', NODE_ENV: 'development' }).devLogin).toBe(true);
  });

  it('kötelező a DATABASE_URL és a legalább 32 bájtos SESSION_SECRET', () => {
    expect(() => loadConfig({ SESSION_SECRET: 's'.repeat(32) })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'rövid' })).toThrow(/SESSION_SECRET/);
    // 16 db kétbájtos karakter = 32 bájt
    expect(loadConfig({ ...base, SESSION_SECRET: 'é'.repeat(16) }).sessionSecret).toHaveLength(16);
  });

  it('érvénytelen időzónát nem fogad el', () => {
    expect(() => loadConfig({ ...base, TZ_DISPLAY: 'Mars/Olympus' })).toThrow(/TZ_DISPLAY/);
  });
});
