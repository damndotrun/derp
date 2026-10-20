import { expect, test } from 'vitest';
import { direction } from '../server/classify.ts';

// Portolva: email-project-timeline src/test/classify.direction.test.js
const own = ['dokakft.hu'];

test('SENT label => out', () => {
  expect(direction({ from: 'x@lindab.com', labelIds: ['SENT'] }, own)).toBe('out');
});
test('from own domain => out', () => {
  expect(direction({ from: 'ifj.doka.karoly@dokakft.hu', labelIds: ['INBOX'] }, own)).toBe('out');
});
test('external inbox => in', () => {
  expect(direction({ from: 'ertekesites@lindab.com', labelIds: ['INBOX'] }, own)).toBe('in');
});
