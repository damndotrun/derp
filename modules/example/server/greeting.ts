import type { Db } from '@derp/server/module-api';
import { exampleGreeting } from './schema.ts';

export const DEFAULT_GREETING = 'Üdv a minta modulból!';
export const E2E_GREETING = 'Üdv a minta modul tesztadatából!';

export async function getGreeting(db: Db): Promise<string> {
  const [row] = await db.select({ text: exampleGreeting.text }).from(exampleGreeting).limit(1);
  return row?.text ?? DEFAULT_GREETING;
}
