import { expect, test } from 'vitest';
import { detectProject, type ProjectRule } from '../server/classify.ts';

// Portolva: email-project-timeline src/test/classify.project.test.js (a szabálynak itt azonosítója is van).
const rules: ProjectRule[] = [
  { id: 'r1', name: 'Levendula', color: '#111', pattern: 'levendula' },
  { id: 'r2', name: 'Békéscsaba', color: '#222', pattern: 'békéscsaba|székház' },
];

test('first matching rule wins', () => {
  const p = detectProject('Levendula teremgarázs CO ajánlat', rules);
  expect(p?.name).toBe('Levendula');
});
test('matches second rule via alternation', () => {
  expect(detectProject('BCS székház szellőzés', rules)?.name).toBe('Békéscsaba');
});
test('no match => null', () => {
  expect(detectProject('Havi hírlevél akciók', rules)).toBeNull();
});
test('case-insensitive', () => {
  expect(detectProject('LEVENDULA', rules)?.name).toBe('Levendula');
});
