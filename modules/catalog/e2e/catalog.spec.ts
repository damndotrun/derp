import { expect, test, type Page } from '@playwright/test';

// 9. munkacsomag: Ildi (iroda) a „Cikktörzs” oldalon 3 cikket importál egy CSV-ből (magyar ékezetek, vesszős tizedes,
// pontosvesszős tagolás, mint a magyar Excel mentése) egy hibás sorral együtt. Várt: az előnézet 3 új cikket és 1 hibás
// sort mutat, az import után a 3 cikk a listában kereshető (ékezet nélkül is), a hibás sor nem került be.

const IRODA = 'iroda@derp.test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail-cím').fill(email);
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();
}

/** A főmenü egy pontja; telefonos nézetben előbb ki kell nyitni a menüt. */
async function openMenuItem(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Menü megnyitása' });
  if (await open.isVisible()) await open.click();
  await page.getByRole('navigation', { name: 'Főmenü' }).getByRole('link', { name }).click();
}

test('3 cikk CSV-importja előnézettel és hibasor-jelzéssel → a listában kereshető', async ({ page }, info) => {
  // Futásonként (és projektenként) egyedi cikkszámok, hogy az ismételt futás is „új” cikkeket importáljon.
  const p = `PW${info.project.name === 'pixel7' ? 'M' : 'D'}${Date.now().toString(36).toUpperCase()}`;
  const csv = [
    'Cikkszám;Megnevezés;Egység;Nettó egységár;ÁFA-kulcs;Beszállító',
    `${p}-1;Hővisszanyerős szellőztető ${p};db;389 900,00;27;Légtechnika Nagyker Kft.`,
    `${p}-2;Flexibilis alumínium légcsatorna Ø160 ${p};m;1 250,50;27;Légtechnika Nagyker Kft.`,
    `${p}-3;Kondenzvíz-szivattyú ${p};db;24 990;27;Hűtő-Fűtő Bt.`,
    `${p}-4;Elírt ár ${p};db;sok;27;`,
  ].join('\r\n');

  await login(page, IRODA);
  await openMenuItem(page, 'Cikktörzs');
  await expect(page.getByRole('heading', { name: 'Cikktörzs' })).toBeVisible();

  await page.getByLabel('CSV-fájl').setInputFiles({
    name: 'arlista.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`﻿${csv}\r\n`, 'utf8'),
  });

  // Előnézet: 3 új, 1 hibás sor a sorszámával és okával; még semmi nem került be.
  const summary = page.getByRole('list', { name: 'Összesítés' });
  await expect(summary).toContainText('3 új');
  await expect(summary).toContainText('1 hibás sor');
  const preview = page.getByRole('table', { name: 'Előnézet' });
  const errorRow = preview.getByRole('row').filter({ hasText: 'Hibás' });
  await expect(errorRow).toContainText('5');
  await expect(errorRow).toContainText('A nettó egységár nem szám: „sok”');
  await expect(preview.getByRole('row').filter({ hasText: `${p}-2` })).toContainText(/1\s?250,50\sFt/);

  const search = page.getByLabel('Keresés');
  await search.fill(p);
  await expect(page.getByText('Nincs a keresésnek megfelelő cikk.')).toBeVisible();

  await page.getByRole('button', { name: 'Importálás (3 cikk)' }).click();
  await expect(page.getByRole('status')).toHaveText('Import kész: 3 új, 0 frissített cikk.');

  // A lista frissül: a 3 cikk megvan, a hibás nincs.
  const list = page.getByRole('table', { name: 'Cikkek' });
  await expect(page.getByText('3 cikk', { exact: true })).toBeVisible();
  await expect(list.getByRole('row').filter({ hasText: `Hővisszanyerős szellőztető ${p}` })).toContainText(/389\s900\sFt/);
  await expect(list.getByRole('row').filter({ hasText: `${p}-4` })).toHaveCount(0);

  // Keresés ékezet és kis-nagybetű nélkül, több szóval, a beszállítóra is.
  await search.fill(`kondenzviz ${p.toLowerCase()}`);
  await expect(page.getByText('1 cikk', { exact: true })).toBeVisible();
  await expect(list.getByRole('row').nth(1)).toContainText(`Kondenzvíz-szivattyú ${p}`);

  await search.fill(`hűtő-fűtő ${p}`);
  await expect(list.getByRole('row').nth(1)).toContainText(`${p}-3`);
  await expect(page.getByText('1 cikk', { exact: true })).toBeVisible();

  await search.fill(`alumínium ø160 ${p}`);
  await expect(list.getByRole('row').nth(1)).toContainText(/1\s?250,50\sFt/);

  // A keresés az URL-ben marad: újratöltés után is ugyanaz a találat.
  await page.reload();
  await expect(page.getByLabel('Keresés')).toHaveValue(`alumínium ø160 ${p}`);
  await expect(page.getByText('1 cikk', { exact: true })).toBeVisible();

  // A seed cikkei is kereshetők.
  await page.getByLabel('Keresés').fill('LT-VENT-125');
  await expect(list.getByRole('row').nth(1)).toContainText('Csőventilátor Ø125 mm, 230 V');
});
