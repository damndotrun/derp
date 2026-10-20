import { expect, request, test, type APIRequestContext, type Browser, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

// 7. munkacsomag: projekt-chat. A tesztfelhasználók a `pnpm seed:e2e`-ből (Iroda Ildi, Terepes Tamás); Ildi és Tamás
// két külön böngésző-kontextusban.

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

/** Második böngésző-kontextus ugyanazzal az eszköz-beállítással (asztali vagy Pixel 7), mint a teszt saját oldala. */
async function secondPage(browser: Browser, info: TestInfo, baseURL: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId });
  return context.newPage();
}

/** Projekt az irodai felhasználóval; ha `withTamas`, Terepes Tamás hozzárendelve. */
async function createProject(baseURL: string, label: string, info: TestInfo, withTamas: boolean) {
  const iroda = await apiAs(baseURL, IRODA);
  const project = (await (await iroda.post('/api/projects', { data: { name: `${label} (${info.project.name} ${Date.now()})` } })).json()) as {
    id: string;
    name: string;
  };
  if (withTamas) {
    const users = (await (await iroda.get('/api/users')).json()) as { items: Array<{ id: string; email: string }> };
    const tamas = users.items.find((u) => u.email === TEREPES)!.id;
    expect((await iroda.put(`/api/projects/${project.id}/members/${tamas}`)).status()).toBe(204);
  }
  await iroda.dispose();
  return project;
}

const messages = (page: Page) => page.getByRole('list', { name: 'Üzenetek' });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Üzenet' });

test('A ír → B-nél újratöltés nélkül megjelenik; @említés, olvasatlan-jelvény, olvasottság, válasz', async ({ page, browser, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Chat próba', info, true);

  // Tamás (B) a chat kezdőlapján vár.
  const tamas = await secondPage(browser, info, baseURL!);
  await login(tamas, TEREPES);
  await (await openMenu(tamas)).getByRole('link', { name: /^Chat/ }).click();
  const row = tamas.getByRole('list', { name: 'Projektek' }).getByRole('link', { name: new RegExp(project.name.replace(/[()]/g, '\\$&')) });
  await expect(row).toBeVisible();
  await expect(row.getByText(/olvasatlan üzenet/)).toHaveCount(0);

  // Ildi (A) a projekt-adatlapról nyitja a chatet, és @említéssel ír.
  await login(page, IRODA);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('navigation', { name: 'A projekt oldalai' }).getByRole('link', { name: /^Chat/ }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${project.id}$`));
  await expect(page.getByText('Még nincs üzenet. Írd meg az elsőt!')).toBeVisible();
  await composer(page).pressSequentially('@Ter');
  await page.getByRole('listbox', { name: 'Megemlíthető kollégák' }).getByRole('option', { name: 'Terepes Tamás' }).click();
  await composer(page).pressSequentially('nézd meg a gépházat');
  await composer(page).press('Enter');
  await expect(messages(page).getByRole('article', { name: 'Iroda Ildi: @Terepes Tamás nézd meg a gépházat' })).toBeVisible();
  await expect(composer(page)).toHaveValue('');

  // Tamásnál újratöltés nélkül: a projekt sorában és a menüben olvasatlan-jelvény, az említés jelölve.
  await expect(row.getByText('1 olvasatlan üzenet, megemlítettek', { exact: true })).toBeVisible();
  const menu = await openMenu(tamas);
  await expect(menu.getByRole('link', { name: /^Chat \d+ olvasatlan üzenet/ })).toBeVisible();
  if (await tamas.getByRole('button', { name: 'Menü bezárása' }).isVisible()) await tamas.getByRole('button', { name: 'Menü bezárása' }).click();

  // Megnyitva az üzenet ott van, az említés kiemelve; olvasottnak számít.
  await row.click();
  const msg = messages(tamas).getByRole('article', { name: /nézd meg a gépházat/ });
  await expect(msg).toBeVisible();
  await expect(msg.locator('strong[data-mention]')).toHaveText('@Terepes Tamás');
  await expect
    .poll(async () => ((await (await tamas.request.get('/api/chat/unread')).json()) as { projects: Array<{ projectId: string; unread: number }> }).projects.find((p) => p.projectId === project.id)?.unread)
    .toBe(0);

  // Tamás válaszol; Ildinél újratöltés nélkül megjelenik, és látja, hogy Tamás olvasta.
  await composer(tamas).fill('Holnap 8-kor ott vagyok.');
  await tamas.getByRole('button', { name: 'Küldés' }).click();
  await expect(messages(page).getByRole('article', { name: 'Terepes Tamás: Holnap 8-kor ott vagyok.' })).toBeVisible();
  await expect(messages(page).getByText('Látta: Terepes Tamás')).toBeVisible();

  // Az idővonalon mindkét üzenet ott van.
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('list', { name: 'Események' })).toBeVisible();
  const expandAll = page.getByRole('button', { name: 'Mindet kibont' });
  if (await expandAll.count()) await expandAll.click();
  await expect(page.getByText('Chat-üzenet: @Terepes Tamás nézd meg a gépházat')).toBeVisible();
  await expect(page.getByText('Chat-üzenet: Holnap 8-kor ott vagyok.')).toBeVisible();

  await tamas.context().close();
});

test('a csatolt fotó B-nél újratöltés nélkül megjelenik, és a dokumentumtárban is ott van', async ({ page, browser, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Chat fotó', info, true);
  const tamas = await secondPage(browser, info, baseURL!);
  await login(tamas, TEREPES);
  await tamas.goto(`/chat/${project.id}`);
  await expect(tamas.getByText('Még nincs üzenet. Írd meg az elsőt!')).toBeVisible();

  await login(page, IRODA);
  await page.goto(`/chat/${project.id}`);
  const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 120, b: 160 } } }).jpeg().toBuffer();
  await page.getByLabel('Fotó vagy fájl csatolása').setInputFiles([{ name: 'gephaz.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  await expect(page.getByRole('list', { name: 'Csatolmányok' }).getByText('gephaz.jpg')).toBeVisible();
  await composer(page).fill('Így néz ki a gépház.');
  await page.getByRole('button', { name: 'Küldés' }).click();

  for (const p of [page, tamas]) {
    const img = messages(p).getByRole('article', { name: /Így néz ki a gépház/ }).getByRole('img', { name: 'gephaz.jpg' });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  // A dokumentumtárban a „Chat” mappában.
  await page.getByRole('main').getByRole('link', { name: 'Dokumentumtár' }).click();
  await expect(page.getByRole('heading', { name: 'Dokumentumtár' })).toBeVisible();
  await page.getByRole('list', { name: 'Mappák' }).getByRole('button', { name: /Chat/ }).click();
  const files = page.getByRole('list', { name: 'Fájlok' });
  await expect(files.getByRole('img', { name: 'gephaz.jpg' })).toBeVisible();

  // Az idővonalon a fotó az üzenet alatt.
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('list', { name: 'Események' })).toBeVisible();
  const expandAll = page.getByRole('button', { name: 'Mindet kibont' });
  if (await expandAll.count()) await expandAll.click();
  await expect(page.getByText('Fotó feltöltve: gephaz.jpg')).toBeVisible();

  await tamas.context().close();
});

test('a projekt-adatlapról elérhető a chat és a dokumentumtár', async ({ page, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Chat linkek', info, false);
  await login(page, IRODA);
  await page.goto(`/projects/${project.id}`);
  const links = page.getByRole('navigation', { name: 'A projekt oldalai' });
  await expect(links.getByRole('link', { name: /^Chat/ })).toHaveAttribute('href', `/chat/${project.id}`);
  await expect(links.getByRole('link', { name: 'Dokumentumtár' })).toHaveAttribute('href', `/docs/${project.id}`);

  await links.getByRole('link', { name: 'Dokumentumtár' }).click();
  await expect(page.getByRole('heading', { name: 'Dokumentumtár' })).toBeVisible();
  await page.getByRole('link', { name: 'Vissza a projekt adatlapjára' }).click();
  await links.getByRole('link', { name: /^Chat/ }).click();
  await expect(page.getByRole('heading', { name: 'Projekt-chat' })).toBeVisible();
  await expect(page.getByText(project.name)).toBeVisible();
});

test('a terepes nem látja a nem hozzá rendelt projekt chatjét', async ({ page, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Chat tiltott', info, false);
  const iroda = await apiAs(baseURL!, IRODA);
  expect((await iroda.put(`/api/chat/projects/${project.id}/messages/${crypto.randomUUID()}`, { data: { body: 'Belső ügy' } })).status()).toBe(201);
  await iroda.dispose();

  await login(page, TEREPES);
  await page.goto(`/chat/${project.id}`);
  await expect(page.getByRole('alert')).toHaveText('Nincs jogosultság ehhez a projekthez.');
  await expect(page.getByText('Belső ügy')).toHaveCount(0);
  expect((await page.request.get(`/api/chat/projects/${project.id}/messages`)).status()).toBe(403);

  await page.goto('/chat');
  await expect(page.getByRole('list', { name: 'Projektek' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(project.name.replace(/[()]/g, '\\$&')) })).toHaveCount(0);
});
