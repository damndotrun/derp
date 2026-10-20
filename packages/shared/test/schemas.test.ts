import { describe, expect, it } from 'vitest';
import { ContactCreate, EventType, ModuleManifestData, ProjectCreate, ProjectUpdate, UserUpdate } from '../src/index.ts';

describe('ProjectCreate', () => {
  it('levágja a szóközöket, ügyfél nélkül is létrehozható', () => {
    expect(ProjectCreate.parse({ name: '  Minta  ' })).toEqual({ name: 'Minta', clientId: null });
  });

  it('üres nevet nem enged', () => {
    expect(ProjectCreate.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('ProjectUpdate', () => {
  it('verziót és legalább egy mezőt kér', () => {
    expect(ProjectUpdate.safeParse({ version: 1 }).success).toBe(false);
    expect(ProjectUpdate.safeParse({ name: 'X' }).success).toBe(false);
    expect(ProjectUpdate.safeParse({ version: 1, clientId: null }).success).toBe(true);
  });
});

describe('EventType', () => {
  it('<modul>.<esemény> alakot vár', () => {
    expect(EventType.safeParse('core.project_created').success).toBe(true);
    expect(EventType.safeParse('project_created').success).toBe(false);
    expect(EventType.safeParse('Core.x').success).toBe(false);
  });
});

describe('ModuleManifestData', () => {
  it('alapértékekkel tölti ki a nem kötelező részeket', () => {
    expect(ModuleManifestData.parse({ id: 'example', version: '0.1.0' })).toEqual({
      id: 'example',
      version: '0.1.0',
      dependsOn: [],
      menu: [],
      eventTypes: [],
      permissions: [],
    });
  });

  it('ellenőrzi az azonosítót, a menü-útvonalat és a szerepköröket', () => {
    expect(ModuleManifestData.safeParse({ id: 'Example', version: '0.1.0' }).success).toBe(false);
    expect(ModuleManifestData.safeParse({ id: 'x', version: '0.1.0', menu: [{ path: 'x', labelKey: 'x.m' }] }).success).toBe(false);
    expect(
      ModuleManifestData.safeParse({ id: 'x', version: '0.1.0', permissions: [{ key: 'x.read', roles: ['vezeto'] }] }).success,
    ).toBe(false);
  });
});

describe('ContactCreate', () => {
  it('üres vagy érvényes e-mail-címet fogad el', () => {
    expect(ContactCreate.parse({ name: 'Kovács Béla' })).toMatchObject({ email: '', phone: '' });
    expect(ContactCreate.safeParse({ name: 'K', email: ' bela@minta.hu ' }).data?.email).toBe('bela@minta.hu');
    expect(ContactCreate.safeParse({ name: 'K', email: 'nem-email' }).success).toBe(false);
  });
});

describe('UserUpdate', () => {
  it('verziót és legalább egy mezőt kér, ismeretlen szerepkört nem enged', () => {
    expect(UserUpdate.safeParse({ version: 1 }).success).toBe(false);
    expect(UserUpdate.safeParse({ version: 1, active: false }).success).toBe(true);
    expect(UserUpdate.safeParse({ version: 1, role: 'vezeto' }).success).toBe(false);
  });
});
