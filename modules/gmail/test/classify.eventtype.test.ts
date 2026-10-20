import { expect, test } from 'vitest';
import { eventType } from '../server/classify.ts';

// Portolva: email-project-timeline src/test/classify.eventtype.test.js
test('order keywords win regardless of direction', () => {
  expect(eventType('Megrendeljük a Lindab idomokat', 'out')).toBe('order');
  expect(eventType('Rendelés visszaigazolás', 'in')).toBe('order');
});
test('outgoing ajánlatkérés => rfq_out', () => {
  expect(eventType('Levendula CO ajánlatkérés', 'out')).toBe('rfq_out');
});
test('incoming ajánlatkérés => client_rfq', () => {
  expect(eventType('Kérnék ajánlatot a szellőzésre', 'in')).toBe('client_rfq');
});
test('incoming ajánlat (no -kér) => quote_in', () => {
  expect(eventType('Csatoltan küldjük árajánlatunkat', 'in')).toBe('quote_in');
});
test('plain coordination => msg', () => {
  expect(eventType('Helyszíni egyeztetés időpont', 'in')).toBe('msg');
});
// A beszállító válasza visszhangozza az ajánlatkérés tárgyát, de ajánlatot küld: beérkező levélnél az ajánlat nyer.
test('incoming reply echoing RFQ subject but delivering a quote => quote_in', () => {
  expect(eventType('Re: Levendula teremgarázs CO ajánlatkérés Csatoltan küldjük árajánlatunkat.', 'in')).toBe('quote_in');
});
test('incoming RFQ that also mentions a sent attachment stays client_rfq when no quote-delivery phrase', () => {
  expect(eventType('Árajánlatkérés a szellőzésre, lásd a csatolt kiírást', 'in')).toBe('client_rfq');
});
