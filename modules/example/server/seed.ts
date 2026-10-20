import type { ModuleSeedContext } from '@derp/server/module-api';
import { E2E_GREETING } from './greeting.ts';
import { exampleGreeting } from './schema.ts';

export async function seed(ctx: ModuleSeedContext): Promise<void> {
  await ctx.db
    .insert(exampleGreeting)
    .values({ id: 1, text: E2E_GREETING })
    .onConflictDoUpdate({ target: exampleGreeting.id, set: { text: E2E_GREETING } });
}
