import { expect, test } from '@playwright/test';

test('dev-login → projekt létrehozása → „Projekt létrehozva” esemény az adatlapon', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('E-mail-cím').fill('admin@derp.test');
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();

  const name = `Minta Kft. – légtechnika felmérés (${testInfo.project.name} ${Date.now()})`;
  await page.getByLabel('Projekt neve').fill(name);
  await page.getByRole('button', { name: 'Projekt létrehozása' }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const events = page.getByRole('list', { name: 'Események' });
  const created = events.getByRole('listitem').filter({ hasText: 'Projekt létrehozva' });
  await expect(created).toHaveCount(1);
  await expect(created).toContainText('Admin Ádám');

  // A projekt a listában is megjelenik.
  await page.getByRole('link', { name: 'Vissza a projektekhez' }).click();
  await expect(page.getByRole('list', { name: 'Projektek' }).getByText(name)).toBeVisible();
});
