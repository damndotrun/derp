import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  createTestApp,
  IRODA_EMAIL,
  login,
  requester,
  TEREPES_EMAIL,
  type TestContext,
} from '../../../apps/server/test/helpers.ts';
import type { CatalogList, ImportPreview, ImportResult } from '../shared/schemas.ts';
import { E2E_ITEMS } from '../server/seed.ts';

let ctx: TestContext;
let admin: ReturnType<typeof requester>;
let iroda: ReturnType<typeof requester>;
let tamas: ReturnType<typeof requester>;
let anon: ReturnType<typeof requester>;

beforeAll(async () => {
  ctx = await createTestApp({ DERP_MODULES: 'catalog' });
  admin = requester(ctx.app, await login(ctx.app, ADMIN_EMAIL));
  iroda = requester(ctx.app, await login(ctx.app, IRODA_EMAIL));
  tamas = requester(ctx.app, await login(ctx.app, TEREPES_EMAIL));
  anon = requester(ctx.app);
});
afterAll(() => ctx.close());

const HEADER = 'Cikkszám;Megnevezés;Egység;Nettó egységár;ÁFA-kulcs;Beszállító';
/** Tesztenként egyedi cikkszám-előtag, hogy a közös adatbázisban a futások ne zavarják egymást. */
const prefix = () => `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const file = (lines: string[], fileName = 'arlista.csv') => ({
  fileName,
  content: Buffer.from(`﻿${[HEADER, ...lines].join('\r\n')}\r\n`, 'utf8').toString('base64'),
});
const search = async (q: string) => (await iroda('GET', `/api/catalog/items?q=${encodeURIComponent(q)}`)).json() as CatalogList;

describe('CSV-import előnézettel', () => {
  it('az előnézet nem ír, megmutatja az új és a hibás sorokat; az import után a cikkek kereshetők', async () => {
    const p = prefix();
    const body = file([
      `${p}-1;Hővisszanyerős szellőztető ${p};db;389 900,00;27;Légtechnika Nagyker Kft.`,
      `${p}-2;Flexibilis alucső Ø160 ${p};m;1 250,50;27;`,
      `${p}-3;Kondenzvíz-szivattyú ${p};db;24 990;27;Klíma Bt.`,
      `${p}-4;Hibás ÁFA;db;100;25;`,
    ]);
    const preview = await iroda('POST', '/api/catalog/import/preview', body);
    expect(preview.statusCode, preview.body).toBe(200);
    const pv = preview.json() as ImportPreview;
    expect(pv).toMatchObject({ fileError: null, encoding: 'UTF-8', delimiter: ';', summary: { new: 3, changed: 0, unchanged: 0, error: 1 } });
    expect(pv.rows[0]).toMatchObject({ line: 5, status: 'error', errors: [expect.stringContaining('Ismeretlen ÁFA-kulcs')] });
    expect(pv.rows.slice(1).map((r) => r.status)).toEqual(['new', 'new', 'new']);
    expect((await search(p)).total).toBe(0);

    const imported = await iroda('POST', '/api/catalog/import', body);
    expect(imported.statusCode, imported.body).toBe(200);
    expect((imported.json() as ImportResult).summary).toEqual({ new: 3, changed: 0, unchanged: 0, error: 1 });

    const all = await search(p);
    expect(all.total).toBe(3);
    expect(all.items.find((i) => i.sku === `${p}-2`)).toMatchObject({
      name: `Flexibilis alucső Ø160 ${p}`,
      unit: 'm',
      netUnitPriceFiller: 125_050,
      vatRate: 27,
      supplier: '',
      version: 1,
    });
    // Ékezet és kis-nagybetű nélkül, több szóval, a beszállítóra is.
    expect((await search(`hovisszanyeros ${p.toLowerCase()}`)).items.map((i) => i.sku)).toEqual([`${p}-1`]);
    expect((await search(`ALUCSO ${p}`)).items.map((i) => i.sku)).toEqual([`${p}-2`]);
    expect((await search(`klima bt ${p}`)).items.map((i) => i.sku)).toEqual([`${p}-3`]);
    expect((await search(`${p}-4`)).total).toBe(0);
  });

  it('ismételt import: a változatlan sor érintetlen, a módosult frissül (verzió nő), és látszik, mi változott', async () => {
    const p = prefix();
    await iroda('POST', '/api/catalog/import', file([`${p}-1;Tolózár ${p};db;5 000;27;A`, `${p}-2;Csőbilincs ${p};db;350;27;A`]));
    const next = file([`${p}-1;Tolózár ${p};db;5 000;27;A`, `${p}-2;Csőbilincs ${p};db;390;27;B`]);
    const pv = (await iroda('POST', '/api/catalog/import/preview', next)).json() as ImportPreview;
    expect(pv.summary).toEqual({ new: 0, changed: 1, unchanged: 1, error: 0 });
    expect(pv.rows.find((r) => r.status === 'changed')).toMatchObject({ line: 3, changed: ['netUnitPriceFiller', 'supplier'] });

    expect((await iroda('POST', '/api/catalog/import', next)).json()).toEqual({ summary: { new: 0, changed: 1, unchanged: 1, error: 0 } });
    const items = (await search(p)).items;
    expect(items.find((i) => i.sku === `${p}-1`)).toMatchObject({ version: 1 });
    expect(items.find((i) => i.sku === `${p}-2`)).toMatchObject({ version: 2, netUnitPriceFiller: 39_000, supplier: 'B' });
  });

  it('Windows-1250 kódolású fájl (magyar Excel) ékezetei épen kerülnek a cikktörzsbe', async () => {
    const p = prefix();
    const text = `Cikkszám;Megnevezés;Egység;Nettó egységár;ÁFA-kulcs\r\n${p};Szűrőbetét ${p};db;1 990,00;27\r\n`;
    const map: Record<string, number> = { á: 0xe1, é: 0xe9, ő: 0xf5, ű: 0xfb, Á: 0xc1 };
    const bytes = Buffer.from([...text].map((c) => map[c] ?? c.charCodeAt(0)));
    const res = await iroda('POST', '/api/catalog/import', { fileName: 'excel.csv', content: bytes.toString('base64') });
    expect(res.json()).toEqual({ summary: { new: 1, changed: 0, unchanged: 0, error: 0 } });
    expect((await search(`szurobetet ${p}`)).items[0]).toMatchObject({ name: `Szűrőbetét ${p}`, netUnitPriceFiller: 199_000 });
  });

  it('hiányzó oszlopnál az előnézet a fájl hibáját adja, az import 400', async () => {
    const body = { fileName: 'rossz.csv', content: Buffer.from('Cikkszám;Megnevezés\nX;Y\n').toString('base64') };
    expect((await iroda('POST', '/api/catalog/import/preview', body)).json()).toMatchObject({
      fileError: expect.stringMatching(/^Hiányzó oszlop a fejlécben: Egység, Nettó egységár, ÁFA-kulcs/),
      rows: [],
    });
    expect((await iroda('POST', '/api/catalog/import', body)).statusCode).toBe(400);
  });

  it('az import az auditnaplóba kerül a darabszámokkal', async () => {
    const p = prefix();
    await iroda('POST', '/api/catalog/import', file([`${p};Audit próba;db;1;27;`], `audit-${p}.csv`));
    const entries = (await admin('GET', '/api/audit?entityType=catalog.import')).json().items as Array<{ label: string; data: unknown }>;
    expect(entries.find((e) => e.label === `audit-${p}.csv`)).toMatchObject({ data: { new: 1, changed: 0, unchanged: 0, error: 0 } });
  });
});

describe('jogosultság és lekérdezés', () => {
  it('a terepes kereshet, de nem importálhat; belépés nélkül 401', async () => {
    const body = file(['X;Y;db;1;27;']);
    expect((await tamas('GET', '/api/catalog/items')).statusCode).toBe(200);
    expect((await tamas('POST', '/api/catalog/import/preview', body)).statusCode).toBe(403);
    expect((await tamas('POST', '/api/catalog/import', body)).statusCode).toBe(403);
    expect((await anon('GET', '/api/catalog/items')).statusCode).toBe(401);
  });

  it('a seed 3 cikke megvan, egy cikk azonosítóval lekérhető, lapozható', async () => {
    const seeded = await Promise.all(E2E_ITEMS.map(async (e) => (await search(e.sku)).items.find((i) => i.sku === e.sku)));
    expect(seeded.map((i) => i && { sku: i.sku, name: i.name, netUnitPriceFiller: i.netUnitPriceFiller })).toEqual(
      E2E_ITEMS.map((e) => ({ sku: e.sku, name: e.name, netUnitPriceFiller: e.netUnitPriceFiller })),
    );
    const one = seeded[0]!;
    expect((await iroda('GET', `/api/catalog/items/${one.id}`)).json()).toEqual(one);
    expect((await iroda('GET', '/api/catalog/items/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    // A seedből kettő Ø125-ös; név szerint rendezve a második oldal (1 elemes lapokkal) a spirálkorcolt cső.
    const page = (await iroda('GET', `/api/catalog/items?q=${encodeURIComponent('ø125 lt-')}&limit=1&offset=1`)).json() as CatalogList;
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.sku)).toEqual(['LT-CSO-125']);
  });

  it('a LIKE különleges karakterei a keresésben szó szerint értendők', async () => {
    expect((await search('%')).total).toBe(0);
    expect((await search('_')).total).toBe(0);
  });
});
