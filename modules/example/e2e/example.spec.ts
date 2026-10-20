import { expect, test, type Page } from '@playwright/test';

// A modulok nélkül (DERP_MODULES üres) futó második példány; a playwright.config.ts állítja be.
const noModulesBaseUrl = process.env.E2E_NO_MODULES_BASE_URL || '';

async function login(page: Page, base = '') {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail-cím').fill('admin@derp.test');
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();
}

/** A főmenü; telefonos nézetben előbb ki kell nyitni. */
async function mainMenu(page: Page) {
  const open = page.getByRole('button', { name: 'Menü megnyitása' });
  if (await open.isVisible()) await open.click();
  const nav = page.getByRole('navigation', { name: 'Főmenü' });
  await expect(nav.getByRole('link', { name: 'Projektek' })).toBeVisible();
  return nav;
}

test('a minta-modul menüpontja megjelenik, ha a DERP_MODULES bekapcsolja', async ({ page }) => {
  await login(page);
  const nav = await mainMenu(page);
  await nav.getByRole('link', { name: 'Minta modul' }).click();
  await expect(page).toHaveURL(/\/example$/);
  await expect(page.getByRole('heading', { name: 'Minta modul', exact: true })).toBeVisible();
  // A modul seedE2E hookja által beállított szöveg.
  await expect(page.getByText('Üdv a minta modul tesztadatából!')).toBeVisible();
});

test('a minta-modul menüpontja eltűnik, ha a DERP_MODULES nem tartalmazza', async ({ page }) => {
  test.skip(!noModulesBaseUrl, 'nincs modulok nélküli példány (E2E_NO_MODULES_BASE_URL)');
  await login(page, noModulesBaseUrl);
  const nav = await mainMenu(page);
  await expect(nav.getByRole('link', { name: 'Minta modul' })).toHaveCount(0);

  await page.goto(`${noModulesBaseUrl}/example`);
  await expect(page.getByText('Ez a modul nincs bekapcsolva.')).toBeVisible();
  expect((await page.request.get(`${noModulesBaseUrl}/api/example/greeting`)).status()).toBe(404);
});

test('a minta-modul eseménye SSE-n, újratöltés nélkül megjelenik a projekt adatlapján', async ({ page, context }, testInfo) => {
  await login(page);
  const name = `SSE próba (${testInfo.project.name} ${Date.now()})`;
  const created = await page.request.post('/api/projects', { data: { name } });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };

  await page.goto(`/projects/${project.id}`);
  const events = page.getByRole('list', { name: 'Események' });
  await expect(events.getByRole('listitem').filter({ hasText: 'Projekt létrehozva' })).toHaveCount(1);
  await expect(page.locator('html[data-stream="ready"]')).toBeAttached();
  // Újratöltéskor ez a jelölő elveszne.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

  // Egy második lapon, a minta-modul oldaláról küldjük az eseményt.
  const other = await context.newPage();
  await other.goto('/example');
  await other.getByLabel('Projekt').selectOption({ label: name });
  await other.getByRole('button', { name: 'Minta esemény küldése' }).click();
  await expect(other.getByRole('status')).toHaveText('Elküldve.');

  const pinged = events.getByRole('listitem').filter({ hasText: 'Minta esemény' });
  await expect(pinged).toHaveCount(1);
  await expect(pinged).toContainText('Üdv a minta modul tesztadatából!');
  await expect(pinged).toContainText('Admin Ádám');
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  await other.close();
});
