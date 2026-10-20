import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

// 11. munkacsomag (mock-forrással, MAIL_SOURCE=mock): a mock Gmail-forrás egy „Re: Minta Kft. ajánlatkérés” szálat ad
// (a futásonként egyedi szálat a teszt-végpont kézbesíti, hogy a teszt ugyanazon az adatbázison újrafuttatható legyen;
// a fixture ugyanilyen tárgyú szálát a közös forgatókönyvnek hagyja). Ildi a „Hozzárendeletlen levelek” listából a
// projekthez rendeli → a levél az idővonalon, kibontva a törzzsel és a csatolmánylistával. Tamás (terepes, nincs
// hozzárendelve) sem a levelek oldalát, sem a projektet, sem a levelet nem látja.

const IRODA = 'iroda@derp.test';
const TEREPES = 'terepes@derp.test';

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

async function newPage(browser: Browser, info: TestInfo): Promise<Page> {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId });
  return context.newPage();
}

test('mock Gmail: szál hozzárendelése a „Hozzárendeletlen levelek” listából → az idővonalon, kibontva a törzzsel; a terepes nem látja', async ({
  page,
  browser,
}, info) => {
  const run = `${info.project.name} ${Date.now()}`;
  const projectName = `Minta Kft. – légtechnika felmérés (${run})`;
  const subject = `Re: Minta Kft. ajánlatkérés (${run})`;

  // 1. Ildi projektet hoz létre.
  await login(page, IRODA);
  await page.getByLabel('Projekt neve').fill(projectName);
  await page.getByRole('button', { name: 'Projekt létrehozása' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  const projectUrl = page.url();

  // 2. A mock-postafiókba új levél érkezik (Ildi munkamenetével, csak NODE_ENV=test alatt létező végponton).
  const delivered = await page.request.post('/api/gmail/test/deliver', {
    data: {
      from: 'Minta Béla <bela@minta-kft.test>',
      subject,
      body: 'Tisztelt Dóka Kft.!\n\nA telefonos egyeztetés alapján kérnénk ajánlatot a csarnok légtechnikai felújítására.\n\nÜdvözlettel:\nMinta Béla',
      attachments: [{ name: 'alaprajz_csarnok.pdf', mimeType: 'application/pdf', size: 183402 }],
    },
  });
  expect(delivered.ok()).toBe(true);

  // 3. „Levelek” → „Hozzárendeletlen levelek”: a szál ott van; a projekthez rendelés.
  await openMenuItem(page, 'Levelek');
  const inbox = page.getByRole('list', { name: 'Hozzárendeletlen levelek' });
  const thread = inbox.getByRole('listitem').filter({ has: page.getByRole('heading', { name: subject }) });
  await expect(thread).toBeVisible();
  await expect(thread).toContainText('Minta Béla');
  await expect(thread).toContainText('1 csatolmány');
  await thread.getByRole('button', { name: /Levelek megtekintése/ }).click();
  await expect(thread).toContainText('csarnok légtechnikai felújítására');
  await thread.getByLabel('Projekt').selectOption({ label: projectName });
  await thread.getByRole('button', { name: 'Hozzárendelés' }).click();
  await expect(page.getByRole('status')).toContainText(`a(z) ${projectName} projekthez került`);
  await expect(inbox.getByRole('heading', { name: subject })).toHaveCount(0);

  // 4. A projekt idővonalán a levél; kibontva a törzs és a csatolmánylista.
  await page.getByRole('link', { name: 'A projekt idővonala' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  const events = page.getByRole('list', { name: 'Események' });
  await expect(events).toBeVisible();
  const expandAll = page.getByRole('button', { name: 'Mindet kibont' });
  if (await expandAll.isVisible()) await expandAll.click();
  const mail = events.getByRole('listitem').filter({ hasText: `Levél: ${subject}` });
  await expect(mail).toBeVisible();
  await expect(mail).toContainText('Feladó: Minta Béla');
  await mail.getByRole('button', { name: /Levél megnyitása/ }).click();
  await expect(mail.getByLabel('A levél szövege')).toContainText('csarnok légtechnikai felújítására');
  await expect(mail.getByRole('list', { name: 'Csatolmányok' })).toContainText('alaprajz_csarnok.pdf');
  if (info.project.name === 'asztali') await page.screenshot({ path: info.outputPath('idovonal-level.png'), fullPage: true });

  // A levél azonosítója az eseményből (a terepes közvetlen API-kéréséhez).
  const projectId = new URL(projectUrl).pathname.split('/').pop()!;
  const list = await page.request.get(`/api/projects/${projectId}/events?types=gmail.message`);
  const messageId = ((await list.json()) as { items: Array<{ data: { messageId: string } }> }).items[0]!.data.messageId;

  // 5. Tamás (terepes, nincs hozzárendelve): nincs „Levelek” menüpont, a projekt és a levél 403.
  const tamas = await newPage(browser, info);
  await login(tamas, TEREPES);
  const openMenu = tamas.getByRole('button', { name: 'Menü megnyitása' });
  if (await openMenu.isVisible()) await openMenu.click();
  await expect(tamas.getByRole('navigation', { name: 'Főmenü' }).getByRole('link', { name: 'Levelek' })).toHaveCount(0);
  await tamas.goto(projectUrl);
  await expect(tamas.getByText('Nincs jogosultság ehhez a projekthez.')).toBeVisible();
  expect((await tamas.request.get(`/api/gmail/messages/${messageId}`)).status()).toBe(403);
  expect((await tamas.request.get('/api/gmail/threads')).status()).toBe(403);
  await tamas.goto('/gmail');
  await expect(tamas.getByRole('alert')).toContainText('Nincs jogosultság.');
  await tamas.context().close();
});
