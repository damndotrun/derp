import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractText } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, IRODA_EMAIL, login, requester, TEREPES_EMAIL, type TestContext } from '../../../apps/server/test/helpers.ts';
import type { CatalogItem, CatalogList } from '../../catalog/shared/schemas.ts';
import { formatFiller } from '../shared/format.ts';
import type { Quote, QuoteItem, QuoteList, QuotePdf, Settings } from '../shared/schemas.ts';

let ctx: TestContext;
let dataDir: string;
let admin: string;
let iroda: string;
let terepes: string;
let terepesId: string;
let catalog: CatalogItem[];

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'quotes-api-'));
  process.env.DATA_DIR = dataDir;
  ctx = await createTestApp({ DERP_MODULES: 'catalog,docs,notes,quotes' });
  admin = await login(ctx.app);
  iroda = await login(ctx.app, IRODA_EMAIL);
  terepes = await login(ctx.app, TEREPES_EMAIL);
  const users = (await as(admin)('GET', '/api/users')).json().items as Array<{ id: string; email: string }>;
  terepesId = users.find((u) => u.email === TEREPES_EMAIL)!.id;
  const list = (await as(iroda)('GET', `/api/catalog/items?q=${encodeURIComponent('LT-')}`)).json() as CatalogList;
  catalog = ['LT-VENT-125', 'LT-CSO-125', 'LT-RACS-200'].map((sku) => list.items.find((i) => i.sku === sku)!);
});
afterAll(async () => {
  await ctx.close();
  delete process.env.DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

const as = (cookie: string) => requester(ctx.app, cookie);

async function project(name: string, members: string[] = []): Promise<string> {
  const client = (await as(iroda)('POST', '/api/clients', { name: `Minta Kft. ${name}`, address: '6000 Kecskemét, Fő utca 1.' })).json();
  const p = (await as(iroda)('POST', '/api/projects', { name, clientId: client.id })).json();
  for (const m of members) expect((await as(admin)('PUT', `/api/projects/${p.id}/members/${m}`)).statusCode).toBe(204);
  return p.id;
}

async function newQuote(projectId: string, cookie = iroda): Promise<Quote> {
  const res = await as(cookie)('POST', `/api/quotes/projects/${projectId}`);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/** A cikk adatai tételként (a felület is így másolja). */
const fromCatalog = (c: CatalogItem, quantity: number, discountPercent = 0): QuoteItem => ({
  id: crypto.randomUUID(),
  catalogItemId: c.id,
  sku: c.sku,
  name: c.name,
  unit: c.unit,
  quantity,
  netUnitPriceFiller: c.netUnitPriceFiller,
  vatRate: c.vatRate,
  discountPercent,
});
const manual = (name: string, quantity: number, netUnitPriceFiller: number, discountPercent = 0): QuoteItem => ({
  id: crypto.randomUUID(),
  catalogItemId: null,
  sku: '',
  name,
  unit: 'db',
  quantity,
  netUnitPriceFiller,
  vatRate: 27,
  discountPercent,
});

const latest = (q: Quote) => q.versions[q.versions.length - 1]!;

async function save(q: Quote, body: Record<string, unknown>, cookie = iroda) {
  const v = latest(q);
  return as(cookie)('PUT', `/api/quotes/versions/${v.id}`, { revision: v.revision, note: '', validUntil: null, ...body });
}

type EventItem = { id: string; type: string; title: string; parentId: string | null; data: Record<string, unknown> };
const events = async (projectId: string): Promise<EventItem[]> => (await as(admin)('GET', `/api/projects/${projectId}/events`)).json().items;

const pdfText = async (bytes: Buffer) => (await extractText(new Uint8Array(bytes), { mergePages: true })).text.replace(/\s+/g, ' ');

describe('ajánlat szerkesztése és összegzése', () => {
  it('három cikktörzs- és egy kézi tétellel: a szerver összesít, a cikk adatai másolódnak', async () => {
    const pid = await project('Összegzés');
    const q = await newQuote(pid);
    expect(q).toMatchObject({ projectId: pid, clientName: 'Minta Kft. Összegzés', versions: [{ versionNo: 1, status: 'tervezet', items: [] }] });

    const items = [fromCatalog(catalog[0]!, 2), fromCatalog(catalog[1]!, 3), fromCatalog(catalog[2]!, 4), manual('Szerelés, beüzemelés', 1, 2_500_000, 10)];
    const res = await save(q, { items, note: 'Az árak a szállítást nem tartalmazzák.', validUntil: '2026-11-30' });
    expect(res.statusCode, res.body).toBe(200);
    const v = latest(res.json() as Quote);
    expect(v).toMatchObject({ revision: 2, note: 'Az árak a szállítást nem tartalmazzák.', validUntil: '2026-11-30' });
    expect(v.items).toEqual(items);
    // A seed 2 150,50 Ft-os légcsatornája 3 m: 6 451,50 Ft.
    expect(v.totals.lineNetFiller).toEqual([9_700_000, 645_150, 1_596_000, 2_250_000]);
    expect(v.totals).toMatchObject({
      byVatRate: [{ vatRate: 27, netFiller: 14_191_150, vatFiller: 3_831_611, grossFiller: 18_022_761 }],
      totalFiller: 18_022_800,
    });

    // A lista a legújabb verzió összegével.
    const list = (await as(iroda)('GET', `/api/quotes/projects/${pid}`)).json() as QuoteList;
    expect(list.items).toEqual([expect.objectContaining({ id: q.id, versionNo: 1, status: 'tervezet', totalFiller: 18_022_800, itemCount: 4 })]);
    expect(((await as(iroda)('GET', '/api/quotes')).json() as QuoteList).items.map((i) => i.id)).toContain(q.id);
  });

  it('eltérő revision-nel küldött mentés 409; érvénytelen tétel 400', async () => {
    const q = await newQuote(await project('Ütközés'));
    expect((await save(q, { items: [manual('A', 1, 100)] })).statusCode).toBe(200);
    // Ugyanazzal a (már elavult) revision-nel újra.
    const stale = await save(q, { items: [manual('B', 1, 100)] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toContain('közben módosították');

    const fresh = (await as(iroda)('GET', `/api/quotes/${q.id}`)).json() as Quote;
    for (const bad of [
      { ...manual('Tört', 1, 100), quantity: 0.0001 },
      { ...manual('Negatív', 1, 100), quantity: -1 },
      { ...manual('ÁFA', 1, 100), vatRate: 25 },
      { ...manual('Kedvezmény', 1, 100), discountPercent: 101 },
      { ...manual('Tört ár', 1, 100), netUnitPriceFiller: 1.5 },
      { ...manual('', 1, 100) },
    ]) {
      expect((await save(fresh, { items: [bad] })).statusCode, bad.name).toBe(400);
    }
    const dup = manual('Kétszer', 1, 100);
    expect((await save(fresh, { items: [dup, dup] })).statusCode).toBe(400);
  });

  it('a cikktörzs későbbi importja nem írja át az ajánlat tételét', async () => {
    const q = await newQuote(await project('Másolat'));
    const sku = `QT${Date.now().toString(36).toUpperCase()}`;
    const csv = (price: string) => ({
      fileName: 'arlista.csv',
      content: Buffer.from(`Cikkszám;Megnevezés;Egység;Nettó egységár;ÁFA-kulcs\r\n${sku};Szűrő ${sku};db;${price};27\r\n`).toString('base64'),
    });
    await as(iroda)('POST', '/api/catalog/import', csv('1 000'));
    const item = ((await as(iroda)('GET', `/api/catalog/items?q=${sku}`)).json() as CatalogList).items[0]!;
    await save(q, { items: [fromCatalog(item, 1)] });
    await as(iroda)('POST', '/api/catalog/import', csv('9 999'));
    const after = (await as(iroda)('GET', `/api/quotes/${q.id}`)).json() as Quote;
    expect(latest(after).items[0]).toMatchObject({ catalogItemId: item.id, netUnitPriceFiller: 100_000, name: `Szűrő ${sku}` });
  });
});

describe('PDF', () => {
  it('a PDF szövegét kinyerve a végösszeg, a tételek és a cég fejléce egyezik; letölthető; esemény az idővonalon', async () => {
    const pid = await project('PDF próba');
    const q = await newQuote(pid);
    const items = [fromCatalog(catalog[0]!, 2), fromCatalog(catalog[1]!, 3), fromCatalog(catalog[2]!, 4), manual('Szerelés, beüzemelés', 1, 2_500_000, 10)];
    const saved = (await save(q, { items, validUntil: '2026-11-30', note: 'Fizetés átutalással, 8 napon belül.' })).json() as Quote;
    const v = latest(saved);

    const res = await as(iroda)('POST', `/api/quotes/versions/${v.id}/pdf`, { revision: v.revision });
    expect(res.statusCode, res.body).toBe(201);
    const pdf = res.json() as QuotePdf;
    expect(pdf).toMatchObject({ fileName: `arajanlat-${q.number}-1.pdf`, revision: v.revision, totalFiller: 18_022_800 });

    const dl = await as(iroda)('GET', `/api/quotes/pdfs/${pdf.id}`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="arajanlat-${q.number}-1.pdf"`);
    expect(dl.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(dl.rawPayload.length).toBe(pdf.size);

    const text = await pdfText(dl.rawPayload);
    const ft = (filler: number) => formatFiller(filler).replace(/\s+/g, ' ');
    expect(text).toContain(`Végösszeg: ${ft(18_022_800)}`);
    expect(ft(18_022_800)).toBe('180 228 Ft');
    expect(text).toContain(`Ajánlat száma: ${q.number}/1`);
    expect(text).toContain('Spirálkorcolt légcsatorna Ø125 mm');
    expect(text).toContain(ft(215_050)); // 2 150,50 Ft egységár
    expect(text).toContain(ft(645_150)); // 6 451,50 Ft nettó érték
    expect(text).toContain(`Bruttó összesen: ${ft(18_022_761)}`);
    expect(text).toContain('Szerelés, beüzemelés');
    expect(text).toContain('Minta Kft. PDF próba');
    expect(text).toContain('Dóka Kft. (teszt)');
    expect(text).toContain('Fizetés átutalással, 8 napon belül.');
    expect(text).toContain('2026. 11. 30.-ig');

    const evs = await events(pid);
    const created = evs.find((e) => e.type === 'quotes.created')!;
    expect(created).toMatchObject({ title: `Árajánlat létrehozva: ${q.number}/1 (Tervezet)`, data: { quoteId: q.id, status: 'tervezet' } });
    expect(evs.find((e) => e.type === 'quotes.pdf_created')).toMatchObject({ parentId: created.id, data: { pdfId: pdf.id } });

    // A PDF egy elavult állapotról nem készül, tétel nélkül sem.
    expect((await as(iroda)('POST', `/api/quotes/versions/${v.id}/pdf`, { revision: v.revision - 1 })).statusCode).toBe(409);
    const empty = await newQuote(pid);
    expect((await as(iroda)('POST', `/api/quotes/versions/${latest(empty).id}/pdf`, { revision: 1 })).statusCode).toBe(400);
  });
});

describe('verziók és státusz', () => {
  it('kiküldés után nem szerkeszthető; új verzió a másolatával; a korábbi verzió és PDF-je megmarad', async () => {
    const pid = await project('Verziók');
    const q = await newQuote(pid);
    let quote = (await save(q, { items: [fromCatalog(catalog[1]!, 3)] })).json() as Quote;
    const v1 = latest(quote);

    // Kiküldés: a PDF az aktuális állapotról magától elkészül.
    const sent = await as(iroda)('POST', `/api/quotes/versions/${v1.id}/status`, { revision: v1.revision, status: 'kikuldve' });
    expect(sent.statusCode, sent.body).toBe(200);
    quote = sent.json();
    const v1sent = latest(quote);
    expect(v1sent).toMatchObject({ status: 'kikuldve', revision: v1.revision + 1 });
    expect(v1sent.pdfs).toHaveLength(1);
    expect(v1sent.pdfs[0]).toMatchObject({ revision: v1.revision, totalFiller: 819_300 });

    // Nem szerkeszthető, PDF sem kérhető rá, tervezetbe nem tehető vissza.
    const locked = await save(quote, { items: [] });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.message).toContain('nem szerkeszthető');
    expect((await as(iroda)('POST', `/api/quotes/versions/${v1.id}/pdf`, { revision: v1sent.revision })).statusCode).toBe(409);
    expect((await as(iroda)('POST', `/api/quotes/versions/${v1.id}/status`, { revision: v1sent.revision, status: 'tervezet' })).statusCode).toBe(409);
    expect((await as(iroda)('POST', `/api/quotes/versions/${v1.id}/status`, { revision: v1sent.revision, status: 'kikuldve' })).statusCode).toBe(400);

    // Új verzió: másolat, tervezet; amíg tervezet van, másik nem készül.
    const nv = await as(iroda)('POST', `/api/quotes/${q.id}/versions`);
    expect(nv.statusCode, nv.body).toBe(201);
    quote = nv.json();
    expect(quote.versions.map((v) => [v.versionNo, v.status])).toEqual([
      [1, 'kikuldve'],
      [2, 'tervezet'],
    ]);
    const v2 = latest(quote);
    expect(v2.items).toEqual(v1sent.items);
    expect(v2.pdfs).toEqual([]);
    expect((await as(iroda)('POST', `/api/quotes/${q.id}/versions`)).statusCode).toBe(409);

    // A 2. verzió módosítása az 1.-t nem érinti.
    quote = (await save(quote, { items: [fromCatalog(catalog[1]!, 5)] })).json();
    expect(quote.versions[0]!.items[0]!.quantity).toBe(3);
    expect(latest(quote).items[0]!.quantity).toBe(5);
    const oldPdf = await as(iroda)('GET', `/api/quotes/pdfs/${v1sent.pdfs[0]!.id}`);
    expect(await pdfText(oldPdf.rawPayload)).toContain(`Végösszeg: ${formatFiller(819_300).replace(/\s+/g, ' ')}`);

    // A régi verzió elfogadottra állítható (kézi státusz), az új elutasítottra is.
    expect((await as(iroda)('POST', `/api/quotes/versions/${v1.id}/status`, { revision: v1sent.revision, status: 'elfogadva' })).statusCode).toBe(200);

    const evs = await events(pid);
    // A kiküldés és a hozzá készült PDF eseménye egy tranzakcióban, azonos időponttal jön létre (sorrendjük köztük kötetlen).
    expect(evs.filter((e) => e.type.startsWith('quotes.')).map((e) => e.title).sort()).toEqual(
      [
        `Árajánlat létrehozva: ${q.number}/1 (Tervezet)`,
        `Árajánlat PDF elkészült: ${q.number}/1`,
        `Árajánlat ${q.number}/1: Kiküldve`,
        `Új ajánlatverzió: ${q.number}/2 (Tervezet)`,
        `Árajánlat ${q.number}/1: Elfogadva`,
      ].sort(),
    );
    const created = evs.find((e) => e.type === 'quotes.created')!;
    expect(evs.filter((e) => e.type === 'quotes.status_changed').every((e) => e.parentId === created.id)).toBe(true);
    expect(evs.find((e) => e.type === 'quotes.status_changed' && e.data.status === 'kikuldve')).toMatchObject({ data: { from: 'tervezet' } });
  });

  it('tétel nélküli ajánlat nem küldhető ki', async () => {
    const q = await newQuote(await project('Üres'));
    const res = await as(iroda)('POST', `/api/quotes/versions/${latest(q).id}/status`, { revision: 1, status: 'kikuldve' });
    expect(res.statusCode).toBe(400);
  });
});

describe('jogosultság', () => {
  it('a terepes a hozzá rendelt projektben sem nyithat meg és nem szerkeszthet ajánlatot (403); belépés nélkül 401', async () => {
    const pid = await project('Terepes', [terepesId]);
    const q = await newQuote(pid);
    const v = latest(q);
    const t = as(terepes);
    expect((await t('POST', `/api/quotes/projects/${pid}`)).statusCode).toBe(403);
    expect((await t('GET', `/api/quotes/projects/${pid}`)).statusCode).toBe(403);
    expect((await t('GET', '/api/quotes')).statusCode).toBe(403);
    expect((await t('GET', `/api/quotes/${q.id}`)).statusCode).toBe(403);
    expect((await t('PUT', `/api/quotes/versions/${v.id}`, { revision: 1, items: [manual('X', 1, 1)] })).statusCode).toBe(403);
    expect((await t('POST', `/api/quotes/versions/${v.id}/status`, { revision: 1, status: 'kikuldve' })).statusCode).toBe(403);
    expect((await t('POST', `/api/quotes/versions/${v.id}/pdf`, { revision: 1 })).statusCode).toBe(403);
    expect((await t('POST', `/api/quotes/${q.id}/versions`)).statusCode).toBe(403);
    expect((await requester(ctx.app)('GET', `/api/quotes/${q.id}`)).statusCode).toBe(401);
    // A tartalom nem változott.
    expect(latest((await as(iroda)('GET', `/api/quotes/${q.id}`)).json() as Quote)).toMatchObject({ revision: 1, items: [] });
  });

  it('nem létező ajánlat 404, törölt projekt ajánlata 404', async () => {
    expect((await as(iroda)('GET', `/api/quotes/${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect((await as(iroda)('PUT', `/api/quotes/versions/${crypto.randomUUID()}`, { revision: 1, items: [] })).statusCode).toBe(404);
    const pid = await project('Törölt');
    const q = await newQuote(pid);
    expect((await as(iroda)('DELETE', `/api/projects/${pid}`)).statusCode).toBe(204);
    expect((await as(iroda)('GET', `/api/quotes/${q.id}`)).statusCode).toBe(404);
  });
});

describe('PDF-fejléc beállításai', () => {
  it('az admin szerkeszti (verzióval), az iroda csak olvassa; a logó PNG/JPEG', async () => {
    const current = (await as(iroda)('GET', '/api/quotes/settings')).json() as Settings;
    expect(current).toMatchObject({ companyName: 'Dóka Kft. (teszt)', hasLogo: true });
    const body = { ...current, address: '6000 Kecskemét, Próba utca 2.' };
    delete (body as Partial<Settings>).hasLogo;
    delete (body as Partial<Settings>).updatedAt;
    expect((await as(iroda)('PUT', '/api/quotes/settings', body)).statusCode).toBe(403);
    const saved = await as(admin)('PUT', '/api/quotes/settings', body);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ address: '6000 Kecskemét, Próba utca 2.', version: current.version + 1 });
    expect((await as(admin)('PUT', '/api/quotes/settings', body)).statusCode).toBe(409);

    const logo = await as(iroda)('GET', '/api/quotes/settings/logo');
    expect(logo.headers['content-type']).toBe('image/png');
    expect((await as(admin)('PUT', '/api/quotes/settings/logo', { mime: 'image/png', content: Buffer.from('nem kép').toString('base64') })).statusCode).toBe(400);
    expect((await as(iroda)('PUT', '/api/quotes/settings/logo', { mime: 'image/png', content: logo.rawPayload.toString('base64') })).statusCode).toBe(403);
    expect((await as(admin)('PUT', '/api/quotes/settings/logo', { mime: 'image/png', content: logo.rawPayload.toString('base64') })).json()).toMatchObject({
      hasLogo: true,
    });
    expect((await as(terepes)('GET', '/api/quotes/settings')).statusCode).toBe(403);
  });
});
