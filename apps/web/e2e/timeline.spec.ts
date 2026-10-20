import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail-cím').fill('admin@derp.test');
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();
}

interface SeedEvent {
  type: string;
  title: string;
  occurredAt: string;
  data?: Record<string, unknown>;
}

/** Új projekt a megadott (múltbeli időpontú) eseményekkel a teszt-végponton át (`NODE_ENV=test`). */
async function projectWithEvents(page: Page, name: string, events: SeedEvent[]): Promise<string> {
  const created = await page.request.post('/api/projects', { data: { name } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const res = await page.request.post('/api/test/events', { data: { projectId: id, events } });
  expect(res.status()).toBe(201);
  return id;
}

const pad = (n: number) => String(n).padStart(2, '0');

test('30 esemény: napi csoport összecsuk/kibont, típuscsoport, mindet kibont/összecsuk, szűrő, heti nézet, élő esemény', async ({
  page,
}, testInfo) => {
  await login(page);
  // 2026. szeptember 1–10. (kedd–csütörtök), naponta két „Projekt módosítva” és egy „Kolléga hozzárendelve”,
  // helyi idő szerint 10, 12 és 14 órakor. A napok két hétre esnek (aug. 31. – szept. 6. és szept. 7–13.).
  const events: SeedEvent[] = [];
  for (let day = 1; day <= 10; day++) {
    events.push(
      { type: 'core.project_updated', title: `Módosítás szept. ${day}. reggel`, occurredAt: `2026-09-${pad(day)}T08:00:00Z` },
      { type: 'core.project_updated', title: `Módosítás szept. ${day}. délben`, occurredAt: `2026-09-${pad(day)}T10:00:00Z` },
      {
        type: 'core.member_added',
        title: `Hozzárendelés szept. ${day}.`,
        occurredAt: `2026-09-${pad(day)}T12:00:00Z`,
        data: { userId: crypto.randomUUID() },
      },
    );
  }
  expect(events).toHaveLength(30);
  const id = await projectWithEvents(page, `Idővonal (${testInfo.project.name} ${Date.now()})`, events);

  await page.goto(`/projects/${id}`);
  const list = page.getByRole('list', { name: 'Események' });
  const items = list.getByRole('listitem');
  // 10 nap + a mai nap („Projekt létrehozva”).
  await expect(page.locator('[data-period]')).toHaveCount(11);
  await expect(page.getByRole('heading', { level: 3 }).first()).toContainText('Ma ·');
  // Alapból a napok kibontva, a típuscsoportok összecsukva: naponta a hozzárendelés látszik, a két módosítás nem.
  await expect(items).toHaveCount(11);
  await expect(list.getByText('Hozzárendelés szept. 5.')).toBeVisible();
  await expect(list.getByText('Módosítás szept. 5. reggel')).toHaveCount(0);

  // Napi csoport összecsukása és kibontása.
  const sept5 = page.locator('[data-period="2026-09-05"]').getByRole('button');
  await expect(sept5).toContainText('2026. szeptember 5., szombat');
  await expect(sept5).toContainText('3 esemény');
  await sept5.click();
  await expect(sept5).toHaveAttribute('aria-expanded', 'false');
  await expect(list.getByText('Hozzárendelés szept. 5.')).toHaveCount(0);
  await expect(items).toHaveCount(10);
  await sept5.click();
  await expect(list.getByText('Hozzárendelés szept. 5.')).toBeVisible();

  // Típuscsoport kibontása.
  const group = page.locator('[data-group="2026-09-05|core.project_updated"]').getByRole('button');
  await expect(group).toContainText('Projekt módosítva');
  await expect(group).toContainText('2 esemény');
  await group.click();
  await expect(list.getByText('Módosítás szept. 5. reggel')).toBeVisible();
  await expect(list.getByText('Módosítás szept. 5. délben')).toBeVisible();
  await expect(items).toHaveCount(13);

  // Mindet összecsuk / kibont.
  await page.getByRole('button', { name: 'Mindet összecsuk' }).click();
  await expect(items).toHaveCount(0);
  await expect(page.locator('[data-period]')).toHaveCount(11);
  await page.getByRole('button', { name: 'Mindet kibont' }).click();
  await expect(items).toHaveCount(31);

  // Szűrés típus szerint.
  await page.getByText('Szűrés típus szerint').click();
  await page.getByRole('checkbox', { name: 'Kolléga hozzárendelve' }).check();
  await expect(items).toHaveCount(10);
  await expect(list.locator('[data-event-type="core.member_added"]')).toHaveCount(10);
  await expect(page.locator('[data-period]')).toHaveCount(10);
  await page.getByRole('checkbox', { name: 'Projekt létrehozva' }).check();
  await expect(items).toHaveCount(11);
  await page.getByRole('button', { name: 'Szűrő törlése' }).click();
  await expect(items).toHaveCount(31);

  // Heti csoportosítás: a mai hét és a két szeptemberi hét (hétfői kezdettel).
  await page.getByLabel('Csoportosítás').selectOption('week');
  await expect(page.locator('[data-period]')).toHaveCount(3);
  await expect(page.locator('[data-period="2026-08-31"]')).toContainText('36. hét · 2026. augusztus 31. – szeptember 6.');
  await expect(page.locator('[data-period="2026-08-31"]')).toContainText('18 esemény');
  await expect(page.locator('[data-period="2026-09-07"]')).toContainText('12 esemény');
  await page.getByLabel('Csoportosítás').selectOption('day');

  // Új esemény újratöltés nélkül: a projekt átnevezése egy másik lapon.
  await expect(page.locator('html[data-stream="ready"]')).toBeAttached();
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  const other = await page.context().newPage();
  const current = (await (await other.request.get(`/api/projects/${id}`)).json()) as { version: number };
  const renamed = await other.request.patch(`/api/projects/${id}`, { data: { version: current.version, name: `Átnevezve ${Date.now()}` } });
  expect(renamed.status()).toBe(200);
  await other.close();
  const live = list.locator('[data-event-type="core.project_updated"]').filter({ hasText: 'Projekt módosítva' });
  await expect(live).toHaveCount(1);
  await expect(live).toContainText('Admin Ádám');
  await expect(items).toHaveCount(32);
  await expect(page.getByRole('heading', { level: 3 }).first()).toContainText('2 esemény');
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test('végtelen görgetés: 120 esemény lapokban töltődik be', async ({ page }, testInfo) => {
  await login(page);
  // 2026. május 1-jétől óránként egy esemény (a legrégebbi a „Régi esemény 1”).
  const start = Date.parse('2026-05-01T06:00:00Z');
  const events: SeedEvent[] = Array.from({ length: 120 }, (_, i) => ({
    type: 'core.project_updated',
    title: `Régi esemény ${i + 1}`,
    occurredAt: new Date(start + i * 3_600_000).toISOString(),
  }));
  const id = await projectWithEvents(page, `Görgetés (${testInfo.project.name} ${Date.now()})`, events);

  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`/api/projects/${id}/events?`)) requests.push(r.url());
  });
  await page.goto(`/projects/${id}`);
  // Típus szerinti csoportosítás nélkül minden betöltött esemény látszik.
  await page.getByRole('checkbox', { name: 'Típus szerint' }).uncheck();
  const items = page.getByRole('list', { name: 'Események' }).getByRole('listitem');
  await expect(items.first()).toBeVisible();

  // Görgetésre a következő lapok (50-esével) betöltődnek, amíg el nem fogynak.
  await expect(async () => {
    await items.last().scrollIntoViewIfNeeded();
    await expect(items).toHaveCount(121, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText('Régi esemény 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Továbbiak betöltése' })).toHaveCount(0);
  const pages = requests.map((u) => new URL(u).searchParams);
  expect(pages[0]!.get('limit')).toBe('50');
  expect(pages[0]!.get('before')).toBeNull();
  expect(new Set(pages.map((p) => p.get('before')).filter(Boolean)).size).toBe(2);
});
