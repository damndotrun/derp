import { expect, test } from 'vitest';
import { deriveStatus, hasDeadline } from '../server/classify.ts';

// Portolva: email-project-timeline src/test/classify.status.test.js
// events: időrendben növekvő, mindegyik {eventType, direction}
test('any order => order status', () => {
  expect(
    deriveStatus([
      { eventType: 'rfq_out', direction: 'out' },
      { eventType: 'order', direction: 'out' },
    ]).key,
  ).toBe('order');
});
test('last event client_rfq => reply needed', () => {
  expect(
    deriveStatus([
      { eventType: 'msg', direction: 'out' },
      { eventType: 'client_rfq', direction: 'in' },
    ]).key,
  ).toBe('client_rfq_reply_needed');
});
test('quote_in + last outgoing => processing', () => {
  expect(
    deriveStatus([
      { eventType: 'quote_in', direction: 'in' },
      { eventType: 'msg', direction: 'out' },
    ]).key,
  ).toBe('quote_processing');
});
test('quote_in + last incoming => received', () => {
  expect(
    deriveStatus([
      { eventType: 'rfq_out', direction: 'out' },
      { eventType: 'quote_in', direction: 'in' },
    ]).key,
  ).toBe('quote_received');
});
test('only rfq_out => rfq_sent', () => {
  expect(deriveStatus([{ eventType: 'rfq_out', direction: 'out' }]).key).toBe('rfq_sent');
});
test('only msgs => discussion', () => {
  expect(deriveStatus([{ eventType: 'msg', direction: 'in' }]).key).toBe('discussion');
});
test('hasDeadline detects határidő and dated month', () => {
  expect(hasDeadline('Leadási határidő hamarosan')).toBe(true);
  expect(hasDeadline('kérem 20 jún-ig')).toBe(true);
  expect(hasDeadline('általános egyeztetés')).toBe(false);
});
