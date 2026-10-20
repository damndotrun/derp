import { and, eq, sql } from 'drizzle-orm';
import type { ModuleSeedContext } from '@derp/server/module-api';
import { settings } from './schema.ts';

/** Tesztadat: a PDF fejléce egy egyszerű logóval, ha az admin még nem töltötte ki (a meglévőt nem írja felül). */
export async function seed(ctx: ModuleSeedContext): Promise<void> {
  const { default: sharp } = await import('sharp');
  const logo = await sharp({ create: { width: 240, height: 80, channels: 3, background: { r: 0, g: 92, b: 153 } } }).png().toBuffer();
  await ctx.db
    .update(settings)
    .set({
      companyName: 'Dóka Kft. (teszt)',
      address: '6000 Kecskemét',
      email: 'iroda@derp.test',
      footer: 'Tesztpéldány: az ajánlat nem valós.',
      logo,
      logoMime: 'image/png',
      version: sql`${settings.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(settings.id, 1), eq(settings.companyName, '')));
}
