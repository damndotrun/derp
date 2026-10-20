import { MockMailSource } from './mock-source.ts';
import type { MailSource } from './source.ts';

export type MailSourceKind = MailSource['kind'];

/** A `MAIL_SOURCE` környezeti változó: `mock` (alapérték, fixture-ökből) vagy `gmail` (élő, 14. munkacsomag). */
export function mailSourceKind(env: NodeJS.ProcessEnv = process.env): MailSourceKind {
  const v = env.MAIL_SOURCE?.trim() || 'mock';
  if (v !== 'mock' && v !== 'gmail') throw new Error(`MAIL_SOURCE: ismeretlen érték „${v}” (mock vagy gmail)`);
  return v;
}

let mock: MockMailSource | undefined;

/** A folyamat mock-postafiókja (a teszt-végpont ebbe kézbesít). */
export function mockSource(): MockMailSource {
  return (mock ??= new MockMailSource());
}

export function createSource(kind: MailSourceKind): MailSource {
  if (kind === 'gmail') {
    throw new Error('MAIL_SOURCE=gmail: az élő Gmail-forrás (GmailSource) a 14. munkacsomagban készül; addig MAIL_SOURCE=mock');
  }
  return mockSource();
}
