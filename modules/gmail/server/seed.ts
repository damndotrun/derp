import type { ModuleSeedContext } from '@derp/server/module-api';
import { addAccount } from './accounts.ts';
import { MockMailSource } from './mock-source.ts';
import { syncAll } from './sync.ts';

/** Az e2e mock-fiókja: a fixture-postafiók (köztük a „Re: Minta Kft. ajánlatkérés” szál) ebbe töltődik be. */
export const E2E_ACCOUNT = 'levelek@derp.test';

/** Tesztadat: egy mock-fiók és a fixture-levelek betöltése. Többször futtatva sem duplikál. */
export async function seed(ctx: ModuleSeedContext): Promise<void> {
  await addAccount(ctx.db, { email: E2E_ACCOUNT, source: 'mock', userId: null });
  const results = await syncAll({ db: ctx.db, appendEvent: ctx.appendEvent, source: new MockMailSource() });
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`gmail seed: ${failed.account}: ${failed.error}`);
}
