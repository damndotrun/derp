import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@derp/shared';
import { translate } from './i18n.ts';
import { buildRegistry, modulesKey, registry, useProjectLinks } from './modules.ts';
import { sessionKey } from './session.ts';

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

  it('az offline sor elemfajtáit beírja a sorba, de csak a saját előtaggal', () => {
    const box = { register: vi.fn() };
    const send = async () => undefined;
    buildRegistry([{ id: 'zeta', messages: {}, outbox: { 'zeta.item': { send } } }], box);
    expect(box.register).toHaveBeenCalledWith('zeta.item', { send });
    expect(() => buildRegistry([{ id: 'eta', messages: {}, outbox: { 'docs.upload': { send } } }], box)).toThrow(/docs\.upload/);
  });

  it('a szerepkörhöz kötött projektlinket (árajánlatok) csak az irodai szerepkörök kapják meg', () => {
    const linksFor = (role: Role) => {
      const client = new QueryClient();
      client.setQueryData(modulesKey, { items: [{ id: 'quotes', menu: [] }] });
      client.setQueryData(sessionKey, { user: { id: 'u1', role } });
      const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
      return renderHook(() => useProjectLinks(), { wrapper }).result.current.map((l) => l.labelKey);
    };
    expect(linksFor('admin')).toEqual(['quotes.projectLink']);
    expect(linksFor('iroda')).toEqual(['quotes.projectLink']);
    expect(linksFor('terepes')).toEqual([]);
  });
});
