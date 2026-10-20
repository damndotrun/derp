import { describe, expect, it } from 'vitest';
import { translate } from './i18n.ts';
import { buildRegistry, registry } from './modules.ts';

const Dummy = () => null;

describe('modulregiszter', () => {
  it('a modules/*/web/index.ts fájlokat könyvtár-bejárással tölti be', () => {
    expect(registry.modules.map((m) => m.id)).toContain('example');
    expect(registry.routes).toContainEqual(expect.objectContaining({ path: '/example', moduleId: 'example' }));
    expect(registry.eventRenderers['example.pinged']).toBeTypeOf('function');
  });

  it('a modulok szövegeit a mag szótárához fűzi', () => {
    expect(translate('example.menu')).toBe('Minta modul');
    expect(translate('projects.title')).toBe('Projektek');
    expect(translate('nincs.ilyen')).toBe('nincs.ilyen');
  });

  it('csak a saját előtagú i18n-kulcsot és eseménytípust fogadja el, ütközést nem', () => {
    expect(() => buildRegistry([{ id: 'alpha', messages: { 'beta.x': 'X' } }])).toThrow(/beta\.x/);
    expect(() =>
      buildRegistry([{ id: 'gamma', messages: {}, eventRenderers: { 'core.project_created': Dummy } }]),
    ).toThrow(/core\.project_created/);
    expect(() => buildRegistry([{ id: 'example', messages: { 'example.menu': 'Másik' } }])).toThrow(/kétszer/);
    expect(() =>
      buildRegistry([{ id: 'delta', messages: {}, projectLinks: [{ labelKey: 'projects.title', to: (id) => `/delta/${id}` }] }]),
    ).toThrow(/projects\.title/);
  });

  it('a projektlinkeket és a menüjelvényeket modulonként gyűjti', () => {
    const r = buildRegistry([
      { id: 'epsilon', messages: {}, projectLinks: [{ labelKey: 'epsilon.menu', to: (id) => `/epsilon/${id}` }], menuBadges: { '/epsilon': Dummy } },
    ]);
    expect(r.projectLinks).toEqual([expect.objectContaining({ moduleId: 'epsilon', labelKey: 'epsilon.menu' })]);
    expect(r.projectLinks[0]!.to('p1')).toBe('/epsilon/p1');
    expect(r.menuBadges.get('epsilon:/epsilon')).toBe(Dummy);
  });
});
