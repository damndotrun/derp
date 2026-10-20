import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

// 2b. munkacsomag: szerepkörök és terepes-szűrés, ügyfelek és kapcsolattartók, auditnapló, nyilvános adatvédelmi oldal.
// A tesztfelhasználók a `pnpm seed:e2e`-ből: Admin Ádám (admin), Iroda Ildi (iroda), Terepes Tamás (terepes).

const ADMIN = 'admin@derp.test';
const IRODA = 'iroda@derp.test';
const TEREPES = 'terepes@derp.test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail-cím').fill(email);
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();
}

/** API-kliens egy felhasználó munkamenetével (tesztadatok előkészítéséhez). */
async function apiAs(baseURL: string, email: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  expect((await ctx.post('/api/dev-login', { data: { email } })).status()).toBe(200);
  return ctx;
}

async function userId(api: APIRequestContext, email: string): Promise<string> {
  const users = (await (await api.get('/api/users')).json()) as { items: Array<{ id: string; email: string }> };
  return users.items.find((u) => u.email === email)!.id;
}

/** A főmenü; telefonos nézetben előbb ki kell nyitni. */
async function openMenu(page: Page) {
  const open = page.getByRole('button', { name: 'Menü megnyitása' });
  if (await open.isVisible()) await open.click();
  return page.getByRole('navigation', { name: 'Főmenü' });
}

const unique = (label: string, project: string) => `${label} (${project} ${Date.now()})`;

test('terepes: nem hozzá rendelt projektre 403 (API és felület), és az SSE-n sem kap róla eseményt', async ({ page, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const tamas = await userId(iroda, TEREPES);
  const mine = (await (await iroda.post('/api/projects', { data: { name: unique('Tamás projektje', info.project.name) } })).json()) as {
    id: string;
    name: string;
  };
  const other = (await (await iroda.post('/api/projects', { data: { name: unique('Idegen projekt', info.project.name) } })).json()) as {
    id: string;
    name: string;
  };
  expect((await iroda.put(`/api/projects/${mine.id}/members/${tamas}`)).status()).toBe(204);

  await login(page, TEREPES);
  const list = page.getByRole('list', { name: 'Projektek' });
  await expect(list.getByText(mine.name)).toBeVisible();
  await expect(list.getByText(other.name)).toHaveCount(0);
  // A terepes nem hoz létre projektet.
  await expect(page.getByRole('button', { name: 'Projekt létrehozása' })).toHaveCount(0);

  // API: 403 a projektre és az eseményeire.
  expect((await page.request.get(`/api/projects/${other.id}`)).status()).toBe(403);
  expect((await page.request.get(`/api/projects/${other.id}/events`)).status()).toBe(403);

  // Felület: „Nincs jogosultság”.
  await page.goto(`/projects/${other.id}`);
  await expect(page.getByRole('alert')).toHaveText('Nincs jogosultság ehhez a projekthez.');

  // SSE: a böngészőben nyitott saját folyam gyűjti a beérkező eseményeket.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const w = window as unknown as { __events: Array<{ projectId: string; type: string }> };
        w.__events = [];
        const source = new EventSource('/api/stream');
        source.addEventListener('ready', () => resolve());
        source.addEventListener('event', (m) => w.__events.push(JSON.parse((m as MessageEvent).data)));
      }),
  );
  // Előbb az idegen, utána a saját projekt módosul: ha az idegen eseménye átjönne, előbb érkezne meg.
  expect((await iroda.patch(`/api/projects/${other.id}`, { data: { version: 1, name: `${other.name} (mód.)` } })).status()).toBe(200);
  expect((await iroda.patch(`/api/projects/${mine.id}`, { data: { version: 1, name: `${mine.name} (mód.)` } })).status()).toBe(200);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __events: Array<{ projectId: string; type: string }> }).__events))
    .toContainEqual(expect.objectContaining({ projectId: mine.id, type: 'core.project_updated' }));
  const received = await page.evaluate(() => (window as unknown as { __events: Array<{ projectId: string }> }).__events);
  expect(received.filter((e) => e.projectId === other.id)).toEqual([]);
  await iroda.dispose();
});

test('iroda: ügyfél + kapcsolattartó felvétele, projekt az ügyfélhez, a terepes látja az elérhetőséget', async ({ page, browser, baseURL }, info) => {
  await login(page, IRODA);
  await (await openMenu(page)).getByRole('link', { name: 'Ügyfelek' }).click();
  await expect(page.getByRole('heading', { name: 'Ügyfelek' })).toBeVisible();

  const clientName = unique('Minta Kft.', info.project.name);
  await page.getByLabel('Ügyfél neve').fill(clientName);
  await page.getByLabel('Cím').fill('6000 Kecskemét, Fő utca 1.');
  await page.getByRole('button', { name: 'Ügyfél felvétele' }).click();
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible();

  await page.getByLabel('Név').fill('Kovács Béla');
  await page.getByLabel('Beosztás').fill('műszaki vezető');
  await page.getByLabel('Telefon').fill('+36 30 123 4567');
  await page.getByLabel('E-mail').fill('bela@minta.example');
  await page.getByRole('button', { name: 'Kapcsolattartó felvétele' }).click();
  const contacts = page.getByRole('list', { name: 'Kapcsolattartók' });
  await expect(contacts.getByText('Kovács Béla')).toBeVisible();
  await expect(contacts.getByRole('link', { name: '+36 30 123 4567' })).toHaveAttribute('href', 'tel:+36301234567');

  // Projekt az ügyfélhez, Tamás hozzárendelése.
  await (await openMenu(page)).getByRole('link', { name: 'Projektek' }).click();
  const projectName = unique('Minta Kft. – légtechnika felmérés', info.project.name);
  await page.getByLabel('Projekt neve').fill(projectName);
  await page.getByLabel('Ügyfél').selectOption({ label: clientName });
  await page.getByRole('button', { name: 'Projekt létrehozása' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByRole('link', { name: clientName })).toBeVisible();
  await page.getByLabel('Kolléga').selectOption({ label: 'Terepes Tamás (terepes)' });
  await page.getByRole('button', { name: 'Hozzárendelés' }).click();
  await expect(page.getByRole('list', { name: 'Hozzárendelt kollégák' }).getByText('Terepes Tamás')).toBeVisible();
  const events = page.getByRole('list', { name: 'Események' });
  await expect(events.getByText('Kolléga hozzárendelve: Terepes Tamás')).toBeVisible();
  const projectUrl = page.url();

  // Tamás (külön böngésző-kontextusban) a hozzá rendelt projekten látja az ügyfél elérhetőségét.
  const tamasContext = await browser.newContext({ baseURL });
  const tamas = await tamasContext.newPage();
  await login(tamas, TEREPES);
  await tamas.goto(projectUrl);
  await expect(tamas.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(tamas.getByRole('list', { name: 'Kapcsolattartók' }).getByRole('link', { name: '+36 30 123 4567' })).toBeVisible();
  await expect(tamas.getByRole('button', { name: 'Szerkesztés' })).toHaveCount(0);
  await tamasContext.close();
});

test('admin: az auditnaplóban ott a megtekintés', async ({ page, browser, baseURL }, info) => {
  const iroda = await apiAs(baseURL!, IRODA);
  const project = (await (await iroda.post('/api/projects', { data: { name: unique('Auditált projekt', info.project.name) } })).json()) as {
    id: string;
    name: string;
  };
  await iroda.dispose();

  // Ildi megnyitja a projekt adatlapját.
  const ildiContext = await browser.newContext({ baseURL });
  const ildi = await ildiContext.newPage();
  await login(ildi, IRODA);
  await ildi.goto(`/projects/${project.id}`);
  await expect(ildi.getByRole('heading', { name: project.name })).toBeVisible();
  await ildiContext.close();

  await login(page, ADMIN);
  await (await openMenu(page)).getByRole('link', { name: 'Auditnapló' }).click();
  await expect(page.getByRole('heading', { name: 'Auditnapló' })).toBeVisible();
  await page.getByLabel('Felhasználó').selectOption({ label: 'Iroda Ildi' });
  await page.getByLabel('Művelet').selectOption({ label: 'Megtekintés' });
  const row = page.getByRole('list', { name: 'Auditnapló' }).getByRole('listitem').filter({ hasText: project.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Iroda Ildi');
  await expect(row).toContainText('Megtekintés');
  await expect(row).toContainText(`Projekt: ${project.name}`);
});

test('admin: felhasználó felvétele az adminfelületen', async ({ page }, info) => {
  await login(page, ADMIN);
  await (await openMenu(page)).getByRole('link', { name: 'Felhasználók' }).click();
  const email = `uj.kollega.${info.project.name}.${Date.now()}@derp.test`;
  const form = page.getByRole('form', { name: 'Új felhasználó' });
  await form.getByLabel('E-mail-cím').fill(email);
  await form.getByLabel('Név').fill('Új Kolléga');
  await form.getByLabel('Szerepkör').selectOption({ label: 'iroda' });
  await form.getByRole('button', { name: 'Felhasználó felvétele' }).click();
  const row = page.getByRole('list', { name: 'Felhasználók' }).getByRole('listitem').filter({ hasText: email });
  await expect(row).toContainText('Új Kolléga');
  await expect(row.getByLabel('Szerepkör')).toHaveValue('iroda');
});

test('az /adatvedelem belépés nélkül 200', async ({ page }) => {
  const res = await page.goto('/adatvedelem');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Adatvédelmi tájékoztató' })).toBeVisible();
  // A belépő oldalról is elérhető.
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Adatvédelmi tájékoztató' })).toHaveAttribute('href', '/adatvedelem');
});
