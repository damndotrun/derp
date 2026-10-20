import { readFile } from 'node:fs/promises';
import { expect, request, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { extractText } from 'unpdf';

// 10. munkacsomag: Ildi (iroda) a projekt felmérése és fotói mellett árajánlatot készít a cikktörzs három cikkéből és
// egy kézi tételből (a felmérés anyagtételéből), majd PDF-et kér. Várt: a PDF letölthető, a kinyert szövegében a
// végösszeg egyezik a felületen látottal (és a tételekből számolttal), az ajánlat „Tervezet” az idővonalon. Terepes
// Tamás nem nyithatja meg és nem szerkesztheti az ajánlatot (403). A tesztfelhasználók és a 3 cikk a `pnpm seed:e2e`-ből.

const IRODA = 'iroda@derp.test';
const TEREPES = 'terepes@derp.test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail-cím').fill(email);
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();
}

async function apiAs(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  expect((await ctx.post('/api/dev-login', { data: { email } })).status()).toBe(200);
  return ctx;
}

const jpeg = (r: number, g: number, b: number) =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();

/** Ügyfél és projekt Tamással; Tamás felmérése a becsült anyaggal és egy fotóval (a felmérés eseménye alá). */
async function projectWithSurvey(baseURL: string, info: TestInfo) {
  const iroda = await apiAs(baseURL, IRODA);
  const suffix = `${info.project.name} ${Date.now()}`;
  const client = await (await iroda.post('/api/clients', { data: { name: `Minta Kft. (${suffix})`, address: '6000 Kecskemét, Fő utca 1.' } })).json();
  const project = (await (await iroda.post('/api/projects', { data: { name: `Légtechnika felmérés (${suffix})`, clientId: client.id } })).json()) as {
    id: string;
    name: string;
  };
  const users = (await (await iroda.get('/api/users')).json()) as { items: Array<{ id: string; email: string }> };
  const tamasId = users.items.find((u) => u.email === TEREPES)!.id;
  expect((await iroda.put(`/api/projects/${project.id}/members/${tamasId}`)).status()).toBe(204);
  await iroda.dispose();

  const tamas = await apiAs(baseURL, TEREPES);
  const photoId = crypto.randomUUID();
  const survey = await tamas.put(`/api/notes/projects/${project.id}/surveys/${crypto.randomUUID()}`, {
    data: {
      location: 'Gépház, 2. emelet',
      condition: 'A régi elszívó zajos, a légcsatorna korrodált.',
      proposedWork: 'Ventilátorcsere, légcsatorna és befúvó rácsok cseréje.',
      materials: [
        { name: 'Csőventilátor Ø125', quantity: 2, unit: 'db' },
        { name: 'Spirálkorcolt cső Ø125', quantity: 3, unit: 'm' },
        { name: 'Befúvó rács', quantity: 4, unit: 'db' },
        { name: 'Szerelés, beüzemelés', quantity: 1, unit: 'klt' },
      ],
      photos: [{ id: photoId, name: 'gephaz.jpg' }],
    },
  });
  expect(survey.status()).toBe(201);
  const { eventId } = (await survey.json()) as { eventId: string };
  const upload = await tamas.put(
    `/api/docs/projects/${project.id}/files/${photoId}?${new URLSearchParams({ name: 'gephaz.jpg', type: 'image/jpeg', parentEventId: eventId })}`,
    { data: await jpeg(40, 110, 150), headers: { 'content-type': 'application/octet-stream' } },
  );
  expect(upload.status()).toBe(201);
  await tamas.dispose();
  return project;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

test('felmérés mellett ajánlat három cikktörzs- és egy kézi tétellel → PDF letölthető, a végösszeg egyezik', async ({ page, baseURL }, info) => {
  const project = await projectWithSurvey(baseURL!, info);

  await login(page, IRODA);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('navigation', { name: 'A projekt oldalai' }).getByRole('link', { name: 'Árajánlatok' }).click();
  await expect(page.getByText('Ehhez a projekthez még nincs árajánlat.')).toBeVisible();
  await page.getByRole('button', { name: '+ Új árajánlat' }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
  const heading = page.getByRole('heading', { level: 1, name: /^Árajánlat \d+\/1$/ });
  await expect(heading).toBeVisible();
  const ref = (await heading.textContent())!.replace('Árajánlat ', '');

  // Az oldalpanelen a felmérés (a becsült anyaggal) és a fotó.
  const panel = page.getByRole('complementary', { name: 'A projekt adatai' });
  await expect(panel.getByRole('article', { name: 'Felmérés: Gépház, 2. emelet' })).toBeVisible();
  await expect(panel.getByText('Ventilátorcsere, légcsatorna és befúvó rácsok cseréje.')).toBeVisible();
  await panel.getByRole('tab', { name: 'Fotók (1)' }).click();
  await expect(panel.getByRole('list', { name: 'Fotók' }).getByRole('img', { name: 'gephaz.jpg' })).toBeVisible();
  await panel.getByRole('tab', { name: /^Felmérések/ }).click();

  // 1–2. tétel a cikktörzsből kereséssel.
  const search = page.getByLabel('Cikk keresése a cikktörzsben');
  const results = page.getByRole('list', { name: 'Találatok a cikktörzsben' });
  await search.fill('LT-VENT-125');
  await results.getByRole('button', { name: 'Felvétel: Csőventilátor Ø125 mm, 230 V' }).click();
  await page.getByLabel('Mennyiség 1', { exact: true }).fill('2');
  await search.fill('spirálkorcolt');
  await results.getByRole('button', { name: 'Felvétel: Spirálkorcolt légcsatorna Ø125 mm' }).click();
  await page.getByLabel('Mennyiség 2', { exact: true }).fill('3');
  await expect(page.getByLabel('Nettó egységár (Ft) 2', { exact: true })).toHaveValue('2150,50');
  // 3. tétel: a felmérés anyagtételéből cikkereséssel.
  await panel.getByRole('button', { name: 'Keresés a cikktörzsben: Befúvó rács' }).click();
  await expect(search).toHaveValue('Befúvó rács');
  await results.getByRole('button', { name: 'Felvétel: Befúvó rács 200×100 mm, állítható lamellás' }).click();
  await page.getByLabel('Mennyiség 3', { exact: true }).fill('4');
  // 4. tétel: a felmérés anyagtétele kézi tételként, egységárral és 10% kedvezménnyel.
  await panel.getByRole('button', { name: 'Kézi tételként: Szerelés, beüzemelés' }).click();
  await expect(page.getByLabel('Megnevezés 4', { exact: true })).toHaveValue('Szerelés, beüzemelés');
  await expect(page.getByLabel('Egység 4', { exact: true })).toHaveValue('klt');
  await page.getByLabel('Nettó egységár (Ft) 4', { exact: true }).fill('25 000');
  await page.getByLabel('Kedvezmény (%) 4', { exact: true }).fill('10');

  // Élő összesítő: 97 000 + 6 451,50 + 15 960 + 22 500 = 141 911,50 nettó, 27% ÁFA 38 316,11, bruttó 180 227,61 → 180 228 Ft.
  await expect(page.getByLabel('Nettó 2', { exact: true })).toHaveText(/^6\s?451,50\sFt$/);
  const total = page.getByRole('status', { name: 'Végösszeg' });
  await expect(total).toHaveText(/^180\s228\sFt$/);
  await expect(page.getByRole('table', { name: 'ÁFA-kulcsonként' }).getByRole('row').nth(1)).toHaveText(/27%.*141\s911,50\sFt.*38\s316,11\sFt.*180\s227,61\sFt/);
  await page.getByLabel('Megjegyzés').fill('Az árak a kiszállást tartalmazzák.');

  await page.getByRole('button', { name: 'Mentés' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mentve.' })).toBeVisible();

  // PDF: letöltődik, a kinyert szövegben a végösszeg a felületen látott.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF készítése' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`arajanlat-${ref.replace('/', '-')}.pdf`);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = normalize((await extractText(new Uint8Array(bytes), { mergePages: true })).text);
  const shown = normalize((await total.textContent())!);
  expect(text).toContain(`Végösszeg: ${shown}`);
  expect(text).toContain(`Ajánlat száma: ${ref}`);
  for (const name of ['Csőventilátor Ø125 mm, 230 V', 'Spirálkorcolt légcsatorna Ø125 mm', 'Befúvó rács 200×100 mm, állítható lamellás', 'Szerelés, beüzemelés']) {
    expect(text).toContain(name);
  }
  expect(text).toContain('Az árak a kiszállást tartalmazzák.');
  await expect(page.getByRole('list', { name: 'PDF-ek' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'PDF-ek' })).toContainText(/180\s228\sFt/);

  // Az idővonalon (az oldalpanelen) az ajánlat „Tervezet” státuszban, alatta a PDF eseménye.
  await panel.getByRole('tab', { name: 'Idővonal' }).click();
  await expect(panel.getByText(`Árajánlat létrehozva: ${ref} (Tervezet)`)).toBeVisible();

  // Kiküldés: utána nem szerkeszthető, módosításhoz új verzió kell; a kiküldött verzió PDF-je megmarad.
  page.once('dialog', (d) => void d.accept());
  await page.getByLabel('Új státusz').selectOption({ label: 'Kiküldve' });
  await page.getByRole('button', { name: 'Módosítás' }).click();
  await expect(page.getByText('Ez a verzió nem szerkeszthető.')).toBeVisible();
  await expect(page.getByLabel('Mennyiség 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Végösszeg' })).toHaveText(/^180\s228\sFt$/);
  await page.getByRole('button', { name: '+ Új verzió készítése' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Árajánlat ${ref.replace(/\/1$/, '/2')}` })).toBeVisible();
  await expect(page.getByLabel('Mennyiség 1', { exact: true })).toHaveValue('2');
  await page.getByLabel('Verzió', { exact: true }).selectOption({ label: '1. verzió – Kiküldve' });
  await expect(page.getByRole('list', { name: 'PDF-ek' }).getByRole('listitem')).toHaveCount(1);
});

test('terepes nem nyithatja meg és nem szerkesztheti az ajánlatot (403)', async ({ page, baseURL }, info) => {
  const project = await projectWithSurvey(baseURL!, info);
  const iroda = await apiAs(baseURL!, IRODA);
  const quote = (await (await iroda.post(`/api/quotes/projects/${project.id}`)).json()) as { id: string; versions: Array<{ id: string; revision: number }> };
  await iroda.dispose();

  const tamas = await apiAs(baseURL!, TEREPES);
  const v = quote.versions[0]!;
  const item = { id: crypto.randomUUID(), catalogItemId: null, sku: '', name: 'Próba', unit: 'db', quantity: 1, netUnitPriceFiller: 100, vatRate: 27, discountPercent: 0 };
  expect((await tamas.put(`/api/quotes/versions/${v.id}`, { data: { revision: v.revision, items: [item] } })).status()).toBe(403);
  expect((await tamas.post(`/api/quotes/projects/${project.id}`)).status()).toBe(403);
  expect((await tamas.get(`/api/quotes/${quote.id}`)).status()).toBe(403);
  await tamas.dispose();

  await login(page, TEREPES);
  // A menüben nincs „Árajánlatok”, az ajánlat oldala „Nincs jogosultság”.
  const open = page.getByRole('button', { name: 'Menü megnyitása' });
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole('navigation', { name: 'Főmenü' }).getByRole('link', { name: 'Jegyzet és felmérés' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Főmenü' }).getByRole('link', { name: 'Árajánlatok' })).toHaveCount(0);
  await page.goto(`/quotes/${quote.id}`);
  await expect(page.getByRole('alert')).toHaveText('Nincs jogosultság az árajánlatokhoz.');
});
