import type { ModuleSeedContext } from '@derp/server/module-api';
import type { ImportValues } from '../shared/schemas.ts';
import { upsertItems } from './items.ts';

/** A végponttól végpontig tartó forgatókönyv 3 cikke (a 7. lépésben az árajánlat ezekből vesz fel tételt). */
export const E2E_ITEMS: ImportValues[] = [
  {
    sku: 'LT-VENT-125',
    name: 'Csőventilátor Ø125 mm, 230 V',
    unit: 'db',
    netUnitPriceFiller: 4_850_000,
    vatRate: 27,
    supplier: 'Légtechnika Nagyker Kft.',
  },
  {
    sku: 'LT-CSO-125',
    name: 'Spirálkorcolt légcsatorna Ø125 mm',
    unit: 'm',
    netUnitPriceFiller: 215_050,
    vatRate: 27,
    supplier: 'Légtechnika Nagyker Kft.',
  },
  {
    sku: 'LT-RACS-200',
    name: 'Befúvó rács 200×100 mm, állítható lamellás',
    unit: 'db',
    netUnitPriceFiller: 399_000,
    vatRate: 27,
    supplier: 'Szellőzés Kereskedőház Zrt.',
  },
];

export async function seed(ctx: ModuleSeedContext): Promise<void> {
  await upsertItems(ctx.db, E2E_ITEMS);
}
