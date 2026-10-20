import { describe, expect, it } from 'vitest';
import { EventType, ProjectCreate, ProjectUpdate } from '../src/index.ts';

describe('ProjectCreate', () => {
  it('levágja a szóközöket és üres ügyfelet ad alapból', () => {
    expect(ProjectCreate.parse({ name: '  Minta  ' })).toEqual({ name: 'Minta', clientName: '' });
  });

  it('üres nevet nem enged', () => {
    expect(ProjectCreate.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('ProjectUpdate', () => {
  it('verziót és legalább egy mezőt kér', () => {
    expect(ProjectUpdate.safeParse({ version: 1 }).success).toBe(false);
    expect(ProjectUpdate.safeParse({ name: 'X' }).success).toBe(false);
    expect(ProjectUpdate.safeParse({ version: 1, clientName: '' }).success).toBe(true);
  });
});

describe('EventType', () => {
  it('<modul>.<esemény> alakot vár', () => {
    expect(EventType.safeParse('core.project_created').success).toBe(true);
    expect(EventType.safeParse('project_created').success).toBe(false);
    expect(EventType.safeParse('Core.x').success).toBe(false);
  });
});
