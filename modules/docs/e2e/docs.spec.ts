import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import sharp from 'sharp';

// 4. munkacsomag: dokumentumtár. A tesztfelhasználók a `pnpm seed:e2e`-ből (Iroda Ildi, Terepes Tamás).

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

async function openMenu(page: Page) {
  const open = page.getByRole('button', { name: 'Menü megnyitása' });
  if (await open.isVisible()) await open.click();
  return page.getByRole('navigation', { name: 'Főmenü' });
}

const unique = (label: string, project: string) => `${label} (${project} ${Date.now()})`;

/** Az idővonalon (3. munkacsomag) a típuscsoportok összecsukva indulnak; ha van „Mindet kibont”, kibontjuk. */
async function expandTimeline(page: Page) {
  await expect(page.getByRole('list', { name: 'Események' })).toBeVisible();
  const expandAll = page.getByRole('button', { name: 'Mindet kibont' });
  if (await expandAll.count()) await expandAll.click();
}

/** Egyszínű JPEG a megadott méretben (a 3000 px-es a kliens oldali kicsinyítést is próbálja). */
const jpeg = (width: number, height: number, r: number) =>
  sharp({ create: { width, height, channels: 3, background: { r, g: 120, b: 160 } } }).jpeg().toBuffer();

test('3 fotó feltöltése → bélyegképek → esemény az eseménylistában', async ({ page, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const project = (await (await iroda.post('/api/projects', { data: { name: unique('Dokumentumtár próba', info.project.name) } })).json()) as {
    id: string;
    name: string;
  };
  await iroda.dispose();

  await login(page, IRODA);
  await (await openMenu(page)).getByRole('link', { name: 'Dokumentumtár' }).click();
  await page.getByRole('list', { name: 'Projektek' }).getByRole('link', { name: project.name }).click();
  await expect(page.getByRole('heading', { name: 'Dokumentumtár' })).toBeVisible();
  await expect(page.getByText(project.name)).toBeVisible();

  // Mappa a fotóknak, abba töltünk fel.
  await page.getByLabel('Mappa neve').fill('Helyszíni fotók');
  await page.getByRole('button', { name: 'Mappa létrehozása' }).click();
  await page.getByRole('list', { name: 'Mappák' }).getByRole('button', { name: /Helyszíni fotók/ }).click();
  await expect(page.getByRole('navigation', { name: 'Mappa helye' }).getByRole('button', { name: 'Helyszíni fotók' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const photos = [
    { name: 'gephaz.jpg', mimeType: 'image/jpeg', buffer: await jpeg(3000, 2000, 10) },
    { name: 'legcsatorna.jpg', mimeType: 'image/jpeg', buffer: await jpeg(1200, 900, 90) },
    { name: 'ventilator.jpg', mimeType: 'image/jpeg', buffer: await jpeg(900, 1200, 200) },
  ];
  await page.getByLabel('Fájlok kiválasztása').setInputFiles(photos);

  const queue = page.getByRole('list', { name: 'Feltöltések' });
  await expect(queue.getByRole('status').filter({ hasText: 'Kész' })).toHaveCount(3);

  // Bélyegképek a fájlrácsban (betöltve, nem törött kép).
  const files = page.getByRole('list', { name: 'Fájlok' });
  await expect(files.getByRole('listitem')).toHaveCount(3);
  for (const name of ['gephaz.jpg', 'legcsatorna.jpg', 'ventilator.jpg']) {
    const img = files.getByRole('img', { name });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  // A 3000 px-es fotó 2560 px-re kicsinyítve ment fel.
  const docs = (await (await page.request.get(`/api/docs/projects/${project.id}`)).json()) as { files: Array<{ id: string; name: string }> };
  const big = docs.files.find((f) => f.name === 'gephaz.jpg')!;
  const stored = await sharp(await (await page.request.get(`/api/docs/files/${big.id}/content`)).body()).metadata();
  expect([stored.width, stored.height]).toEqual([2560, 1707]);

  // Előnézet: a kép nagyban, letöltés-link.
  await files.getByRole('button', { name: 'Előnézet: legcsatorna.jpg' }).click();
  const dialog = page.getByRole('dialog', { name: 'legcsatorna.jpg' });
  await expect(dialog.getByRole('img', { name: 'legcsatorna.jpg' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Letöltés' })).toHaveAttribute('href', /\/content\?download=1$/);
  await dialog.getByRole('button', { name: 'Bezárás' }).click();

  // Az eseménylistában a három feltöltés, bélyegképpel.
  await page.getByRole('link', { name: 'Vissza a projekt adatlapjára' }).click();
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible();
  await expandTimeline(page);
  const events = page.getByRole('list', { name: 'Események' });
  for (const name of ['gephaz.jpg', 'legcsatorna.jpg', 'ventilator.jpg']) {
    const item = events.getByRole('listitem').filter({ hasText: `Fotó feltöltve: ${name}` });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Iroda Ildi');
    await expect.poll(() => item.getByRole('img', { name }).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
});

test('terepes: nem látja a nem hozzá rendelt projekt fájljait (felület és API)', async ({ page, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const users = (await (await iroda.get('/api/users')).json()) as { items: Array<{ id: string; email: string }> };
  const tamas = users.items.find((u) => u.email === TEREPES)!.id;
  const create = async (label: string) =>
    (await (await iroda.post('/api/projects', { data: { name: unique(label, info.project.name) } })).json()) as { id: string; name: string };
  const mine = await create('Tamás dokumentumai');
  const other = await create('Idegen dokumentumok');
  expect((await iroda.put(`/api/projects/${mine.id}/members/${tamas}`)).status()).toBe(204);

  const put = (projectId: string, name: string, body: Buffer) =>
    iroda.put(`/api/docs/projects/${projectId}/files/${crypto.randomUUID()}?name=${encodeURIComponent(name)}&type=image/jpeg`, {
      data: body,
      headers: { 'content-type': 'application/octet-stream' },
    });
  const own = await put(mine.id, 'sajat.jpg', await jpeg(400, 300, 30));
  const secret = await put(other.id, 'titkos.jpg', await jpeg(400, 300, 60));
  expect(own.status()).toBe(201);
  expect(secret.status()).toBe(201);
  const secretId = ((await secret.json()) as { id: string }).id;
  await iroda.dispose();

  await login(page, TEREPES);
  await (await openMenu(page)).getByRole('link', { name: 'Dokumentumtár' }).click();
  const projects = page.getByRole('list', { name: 'Projektek' });
  await expect(projects.getByRole('link', { name: mine.name })).toBeVisible();
  await expect(projects.getByRole('link', { name: other.name })).toHaveCount(0);

  // A sajátjában látja a fájlt.
  await projects.getByRole('link', { name: mine.name }).click();
  await expect(page.getByRole('list', { name: 'Fájlok' }).getByRole('img', { name: 'sajat.jpg' })).toBeVisible();

  // Az idegen projekt dokumentumtára: „Nincs jogosultság”, a fájl adatai és tartalma 403.
  await page.goto(`/docs/${other.id}`);
  await expect(page.getByRole('alert')).toHaveText('Nincs jogosultság ehhez a projekthez.');
  await expect(page.getByText('titkos.jpg')).toHaveCount(0);
  for (const url of [`/api/docs/projects/${other.id}`, `/api/docs/files/${secretId}`, `/api/docs/files/${secretId}/content`, `/api/docs/files/${secretId}/thumb`]) {
    expect((await page.request.get(url)).status(), url).toBe(403);
  }
});

test('húzd-és-ejtsd feltöltés, majd törlés a felületről', async ({ page, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const project = (await (await iroda.post('/api/projects', { data: { name: unique('Ejtés próba', info.project.name) } })).json()) as { id: string };
  await iroda.dispose();

  await login(page, IRODA);
  await page.goto(`/docs/${project.id}`);
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['árlista'], 'árlista.txt', { type: 'text/plain' }));
    return dt;
  });
  await page.getByTestId('docs-dropzone').dispatchEvent('drop', { dataTransfer });
  const files = page.getByRole('list', { name: 'Fájlok' });
  await expect(files.getByRole('listitem').filter({ hasText: 'árlista.txt' })).toHaveCount(1);

  await files.getByRole('button', { name: 'Előnézet: árlista.txt' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('dialog', { name: 'árlista.txt' }).getByRole('button', { name: 'Törlés' }).click();
  await expect(files.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('Ebben a mappában még nincs fájl.')).toBeVisible();

  await page.goto(`/projects/${project.id}`);
  await expandTimeline(page);
  await expect(page.getByRole('list', { name: 'Események' }).getByText('Fájl törölve: árlista.txt')).toBeVisible();
});
