import { readFile } from 'node:fs/promises';
import { expect, request, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

// 12. munkacsomag: mappafigyelő. A tesztfelhasználók a `pnpm seed:e2e`-ből (Iroda Ildi, Terepes Tamás); a fájlokat a
// `POST /api/test/watch-file` végpont írja a WATCH_ROOT alá (csak NODE_ENV=test).

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

/** Futásonként egyedi mappa- és projektnév (a WATCH_ROOT a futások között megmaradhat). */
const unique = (label: string, info: TestInfo) => `${label} ${info.project.name} ${Date.now()}`;

async function writeFile(api: APIRequestContext, path: string, content: string) {
  expect((await api.post('/api/test/watch-file', { data: { path, content } })).status()).toBe(201);
}

async function expandTimeline(page: Page) {
  await expect(page.getByRole('list', { name: 'Események' })).toBeVisible();
  const expandAll = page.getByRole('button', { name: 'Mindet kibont' });
  if (await expandAll.count()) await expandAll.click();
}

test('almappa hozzárendelése → fájl a szerveren → „Most ellenőrizd” → „Új fájl a szerveren” esemény, a fájl letölthető', async ({ page, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const name = unique('Mappafigyelő próba', info);
  const project = (await (await iroda.post('/api/projects', { data: { name } })).json()) as { id: string; name: string };
  const folder = unique('Minta', info).replaceAll(' ', '_');
  // A projekt mappája már létezik a szerveren, benne egy régebbi fájllal.
  await writeFile(iroda, `Projektek/${folder}/meglevo_jegyzokonyv.txt`, 'régebbi fájl');

  await login(page, IRODA);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('navigation', { name: 'A projekt oldalai' }).getByRole('link', { name: 'Szerver-mappa' }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/${project.id}$`));
  await expect(page.getByText('Ehhez a projekthez még nincs szerver-mappa rendelve.')).toBeVisible();

  // Almappa kiválasztása a figyelt gyökérből.
  await page.getByRole('button', { name: 'Mappa hozzárendelése' }).click();
  const picker = page.getByRole('region', { name: 'Mappa kiválasztása' });
  await picker.getByRole('list', { name: 'Almappák' }).getByRole('button', { name: /Projektek/ }).click();
  await picker.getByRole('list', { name: 'Almappák' }).getByRole('button', { name: new RegExp(folder) }).click();
  await expect(picker.getByRole('navigation', { name: 'Mappa helye' }).getByRole('button', { name: folder })).toHaveAttribute('aria-current', 'page');
  await picker.getByRole('button', { name: 'Hozzárendelés' }).click();
  await expect(page.getByTestId('watch-mapping-path')).toHaveText(`Projektek/${folder}`);
  const files = page.getByRole('list', { name: 'Fájlok a szerveren' });
  await expect(files.getByRole('listitem')).toHaveCount(1);
  await expect(files).toContainText('meglevo_jegyzokonyv.txt');

  // A szerveren megjelenik az árlista; a „Most ellenőrizd” észleli.
  await writeFile(iroda, `Projektek/${folder}/arlista_beszallito.pdf`, '%PDF-1.4 beszállítói árlista');
  await page.getByRole('button', { name: 'Most ellenőrizd' }).click();
  await expect(page.getByRole('status')).toHaveText('Ellenőrizve: 1 új, 0 módosult, 0 törölt, 0 átnevezett fájl.');
  await expect(files.getByRole('listitem')).toHaveCount(2);
  await iroda.dispose();

  // Az idővonalon: „Új fájl a szerveren”, letöltés-linkkel.
  await page.getByRole('link', { name: 'Vissza a projekt adatlapjára' }).click();
  await expandTimeline(page);
  const item = page.getByRole('list', { name: 'Események' }).getByRole('listitem').filter({ hasText: 'Új fájl a szerveren: arlista_beszallito.pdf' });
  await expect(item).toHaveCount(1);
  // A hozzárendeléskor már ott lévő fájl nem esemény.
  await expect(page.getByRole('list', { name: 'Események' }).getByText('meglevo_jegyzokonyv.txt')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await item.getByRole('link', { name: 'Letöltés' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('arlista_beszallito.pdf');
  expect(await readFile(await download.path())).toEqual(Buffer.from('%PDF-1.4 beszállítói árlista'));
});

test('terepes: nem látja a nem hozzá rendelt projekt mappáját (felület és API)', async ({ page, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const users = (await (await iroda.get('/api/users')).json()) as { items: Array<{ id: string; email: string }> };
  const tamas = users.items.find((u) => u.email === TEREPES)!.id;
  const create = async (label: string) =>
    (await (await iroda.post('/api/projects', { data: { name: unique(label, info) } })).json()) as { id: string; name: string };
  const mine = await create('Tamás szerver-mappája');
  const other = await create('Idegen szerver-mappa');
  expect((await iroda.put(`/api/projects/${mine.id}/members/${tamas}`)).status()).toBe(204);
  const tag = unique('Jog', info).replaceAll(' ', '_');
  await writeFile(iroda, `Terepes/${tag}/sajat/rajz.pdf`, 'saját');
  await writeFile(iroda, `Terepes/${tag}/idegen/titkos_ajanlat.pdf`, 'titkos');
  expect((await iroda.put(`/api/watch/projects/${mine.id}/mapping`, { data: { path: `Terepes/${tag}/sajat` } })).status()).toBe(200);
  const secret = (await (await iroda.put(`/api/watch/projects/${other.id}/mapping`, { data: { path: `Terepes/${tag}/idegen` } })).json()) as {
    files: Array<{ id: string }>;
  };
  await iroda.dispose();

  await login(page, TEREPES);
  await (await openMenu(page)).getByRole('link', { name: 'Szerver-mappák' }).click();
  const projects = page.getByRole('list', { name: 'Projektek' });
  await expect(projects.getByRole('link', { name: new RegExp(mine.name) })).toBeVisible();
  await expect(projects.getByRole('link', { name: new RegExp(other.name) })).toHaveCount(0);

  // A sajátjában látja a fájlt és ellenőrizhet, de mappát nem rendelhet hozzá.
  await projects.getByRole('link', { name: new RegExp(mine.name) }).click();
  await expect(page.getByRole('list', { name: 'Fájlok a szerveren' })).toContainText('rajz.pdf');
  await expect(page.getByRole('button', { name: 'Most ellenőrizd' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Másik mappa' })).toHaveCount(0);

  // Az idegen projekt mappája: „Nincs jogosultság”, az API 403.
  await page.goto(`/watch/${other.id}`);
  await expect(page.getByRole('alert')).toHaveText('Nincs jogosultság ehhez a projekthez.');
  await expect(page.getByText('titkos_ajanlat.pdf')).toHaveCount(0);
  for (const url of [`/api/watch/projects/${other.id}`, `/api/watch/files/${secret.files[0]!.id}/content`, '/api/watch/folders']) {
    expect((await page.request.get(url)).status(), url).toBe(403);
  }
  expect((await page.request.post(`/api/watch/projects/${other.id}/scan`)).status()).toBe(403);
});
