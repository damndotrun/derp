import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { User } from '@derp/shared';
import { moduleInfoFor } from '../src/core/module-host.ts';
import { discoverModules, ModuleError, selectModules, type LoadedModule } from '../src/core/modules.ts';
import { createTestApp, login } from './helpers.ts';

/** Ideiglenes modulkönyvtár a megadott manifestekkel (könyvtárnév → manifest-objektum). */
async function fixture(manifests: Record<string, object>, extra: (dir: string) => Promise<void> = async () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'derp-modules-'));
  for (const [name, manifest] of Object.entries(manifests)) {
    await mkdir(join(dir, name));
    await writeFile(join(dir, name, 'manifest.ts'), `export default ${JSON.stringify(manifest)};\n`);
  }
  await extra(dir);
  return dir;
}

const mod = (id: string, over: object = {}) => ({ id, version: '0.1.0', ...over });
const ids = (mods: LoadedModule[]) => mods.map((m) => m.manifest.id);

describe('modulfelfedezés', () => {
  it('beolvassa a manifesteket, alapértékekkel, és felveszi a migrációs könyvtárat', async () => {
    const dir = await fixture({ alpha: mod('alpha'), beta: mod('beta') }, async (d) => {
      await mkdir(join(d, 'beta', 'migrations'));
      await mkdir(join(d, 'nincs_manifest'));
    });
    const found = await discoverModules(dir);
    expect(ids(found)).toEqual(['alpha', 'beta']);
    expect(found[0]!.manifest).toMatchObject({ dependsOn: [], menu: [], eventTypes: [], permissions: [] });
    expect(found[0]!.migrations).toBeNull();
    expect(found[1]!.migrations).toEqual({ scope: 'beta', dir: join(dir, 'beta', 'migrations') });
  });

  it('a hiányzó könyvtár üres listát ad', async () => {
    expect(await discoverModules(join(tmpdir(), 'nincs-ilyen-derp-modul-konyvtar'))).toEqual([]);
  });

  it('elutasítja a könyvtárnévtől eltérő vagy foglalt azonosítót', async () => {
    await expect(discoverModules(await fixture({ alpha: mod('beta') }))).rejects.toThrow(/nem egyezik/);
    await expect(discoverModules(await fixture({ core: mod('core') }))).rejects.toThrow(/foglalt/);
    await expect(discoverModules(await fixture({ Rossz: mod('Rossz') }))).rejects.toThrow(ModuleError);
  });

  it('az eseménytípus, jogosultság és i18n-kulcs a modul előtagjával kezdődjön', async () => {
    const bad = mod('alpha', { eventTypes: [{ type: 'beta.done', labelKey: 'alpha.done' }] });
    await expect(discoverModules(await fixture({ alpha: bad }))).rejects.toThrow(/beta\.done/);
    const badMenu = mod('alpha', { menu: [{ path: '/alpha', labelKey: 'menu.alpha' }] });
    await expect(discoverModules(await fixture({ alpha: badMenu }))).rejects.toThrow(/menu\.alpha/);
  });
});

describe('DERP_MODULES és függőségek', () => {
  const load = async (manifests: Record<string, object>) => discoverModules(await fixture(manifests));

  it('`*` mindent bekapcsol, függőségi sorrendben', async () => {
    const all = await load({
      c: mod('c', { dependsOn: ['a'] }),
      a: mod('a'),
      b: mod('b', { dependsOn: ['c'] }),
      d: mod('d'),
    });
    expect(ids(selectModules(all, '*'))).toEqual(['a', 'd', 'c', 'b']);
  });

  it('csak a felsoroltakat kapcsolja be; üres lista = egyik sem', async () => {
    const all = await load({ a: mod('a'), b: mod('b') });
    expect(ids(selectModules(all, ['b']))).toEqual(['b']);
    expect(selectModules(all, [])).toEqual([]);
  });

  it('hiba: ismeretlen modul, hiányzó függőség, körkörös függőség, ütköző menü-útvonal', async () => {
    const all = await load({ a: mod('a'), b: mod('b', { dependsOn: ['a'] }) });
    expect(() => selectModules(all, ['x'])).toThrow(/ismeretlen modul: x/);
    expect(() => selectModules(all, ['b'])).toThrow(/„b” modulhoz.*: a/);

    const cyclic = await load({ a: mod('a', { dependsOn: ['b'] }), b: mod('b', { dependsOn: ['a'] }) });
    expect(() => selectModules(cyclic, '*')).toThrow(/Körkörös/);

    const clash = await load({
      a: mod('a', { menu: [{ path: '/kozos', labelKey: 'a.menu' }] }),
      b: mod('b', { menu: [{ path: '/kozos', labelKey: 'b.menu' }] }),
    });
    expect(() => selectModules(clash, '*')).toThrow(/\/kozos/);
  });
});

describe('moduleInfoFor', () => {
  it('a menüt és a jogosultságokat a szerepkör szerint szűri', async () => {
    const [m] = await discoverModules(
      await fixture({
        alpha: mod('alpha', {
          menu: [
            { path: '/alpha', labelKey: 'alpha.menu' },
            { path: '/alpha/admin', labelKey: 'alpha.admin', roles: ['admin'] },
          ],
          permissions: [
            { key: 'alpha.read', roles: ['admin', 'iroda', 'terepes'] },
            { key: 'alpha.manage', roles: ['admin'] },
          ],
        }),
      }),
    );
    const user = (role: User['role']): User => ({ id: crypto.randomUUID(), email: 'x@derp.test', name: 'X', role });
    expect(moduleInfoFor(m!, user('admin'))).toMatchObject({
      menu: [{ path: '/alpha', labelKey: 'alpha.menu' }, { path: '/alpha/admin', labelKey: 'alpha.admin' }],
      permissions: ['alpha.read', 'alpha.manage'],
    });
    expect(moduleInfoFor(m!, user('terepes'))).toMatchObject({
      menu: [{ path: '/alpha', labelKey: 'alpha.menu' }],
      permissions: ['alpha.read'],
    });
  });
});

describe('GET /api/modules', () => {
  it('belépés nélkül 401', async () => {
    const t = await createTestApp();
    try {
      expect((await t.app.inject({ method: 'GET', url: '/api/modules' })).statusCode).toBe(401);
    } finally {
      await t.close();
    }
  });

  it('a bekapcsolt modulokat adja, a DERP_MODULES szerint', async () => {
    for (const [env, expected] of [
      ['*', ['example']],
      ['example', ['example']],
      ['', []],
    ] as const) {
      const t = await createTestApp({ DERP_MODULES: env });
      try {
        const cookie = await login(t.app);
        const res = await t.app.inject({ method: 'GET', url: '/api/modules', headers: { cookie } });
        expect(res.statusCode).toBe(200);
        expect(res.json().items.map((m: { id: string }) => m.id)).toEqual(expected);
      } finally {
        await t.close();
      }
    }
  });

  it('ismeretlen modul a DERP_MODULES-ban: az alkalmazás nem indul', async () => {
    await expect(createTestApp({ DERP_MODULES: 'nincs_ilyen' })).rejects.toThrow(/ismeretlen modul/);
  });
});
