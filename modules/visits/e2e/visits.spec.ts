import { expect, request, test, type Browser, type Page, type TestInfo } from '@playwright/test';

// 6. munkacsomag: Ildi (iroda) projektet hoz létre, a projekt adatlapján hozzárendeli Tamást (terepes), és a
// „Kiszállások” oldalon ütemez neki egy kiszállást mára, 2 órával a futás után, 2 órára. Várt: a heti nézetben és az
// idővonalon („Kiszállás ütemezve”) ott van, Tamás ICS-feedjében is, és Tamásnál a „Mai kiszállásaim” mutatja.

const IRODA = 'iroda@derp.test';
const TEREPES = 'terepes@derp.test';
const TZ = 'Europe/Budapest';

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

/** A pillanat helyi dátuma és ideje (`YYYY-MM-DD`, `HH:MM`) Budapesten. */
function local(at: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

test('kiszállás felvétele → heti nézet, idővonal, ICS-feed és a terepes „Mai kiszállásaim”', async ({ page, browser }, info) => {
  const projectName = `Minta Kft. – légtechnika felmérés (${info.project.name} ${Date.now()})`;
  // Mára, a futás után 2 órától 2 órára (percre kerekítve). Késő este a kezdés már holnapra esik: akkor a
  // „Mai kiszállásaim” azt a napot mutatja (`?date=`).
  const now = new Date();
  const start = local(new Date(Math.ceil(now.getTime() / 60_000) * 60_000 + 2 * 3_600_000));
  const end = local(new Date(Math.ceil(now.getTime() / 60_000) * 60_000 + 4 * 3_600_000));
  const today = local(now).date;

  // 1. Ildi: projekt, Tamás hozzárendelése a projekt adatlapján („Kolléga” + „Hozzárendelés”).
  await login(page, IRODA);
  await page.getByLabel('Projekt neve').fill(projectName);
  await page.getByRole('button', { name: 'Projekt létrehozása' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  const projectUrl = page.url();
  await page.getByLabel('Kolléga').selectOption({ label: 'Terepes Tamás (terepes)' });
  await page.getByRole('button', { name: 'Hozzárendelés' }).click();
  await expect(page.getByRole('list', { name: 'Hozzárendelt kollégák' })).toContainText('Terepes Tamás');

  // Kiszállás ütemezése a „Kiszállások” oldalon.
  await openMenuItem(page, 'Kiszállások');
  await expect(page.getByRole('heading', { name: 'Kiszállások', exact: true })).toBeVisible();
  await page.getByLabel('Projekt', { exact: true }).selectOption({ label: projectName });
  await page.getByRole('checkbox', { name: /Terepes Tamás/ }).check();
  await page.getByLabel('Dátum').fill(start.date);
  await page.getByLabel('Kezdés').fill(start.time);
  await page.getByLabel('Vége').fill(end.time);
  await page.getByLabel('Cím', { exact: true }).fill('Kecskemét, Minta utca 1.');
  await page.getByLabel('Feladat').fill('Légtechnikai felmérés, ventilátor');
  await page.getByRole('button', { name: 'Kiszállás ütemezése' }).click();
  await expect(page.getByRole('status')).toContainText('Kiszállás ütemezve.');

  // A heti nézetben (asztalon táblázat, telefonon napi lista) Tamásnál ott a kiszállás.
  const timeLabel = `${start.time}–${end.time}`;
  const chip = page.getByRole('article', { name: new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(timeLabel);
  await expect(chip).toContainText('Kecskemét, Minta utca 1.');
  if (info.project.name === 'asztali') {
    const row = page.getByRole('table', { name: 'Heti nézet' }).getByRole('row', { name: /Terepes Tamás/ });
    await expect(row).toContainText(projectName);
  }

  // Az idővonalon „Kiszállás ütemezve”.
  await page.goto(projectUrl);
  const events = page.getByRole('list', { name: 'Események' });
  const scheduled = events.getByRole('listitem').filter({ hasText: 'Kiszállás ütemezve' });
  await expect(scheduled).toHaveCount(1);
  await expect(scheduled).toContainText(timeLabel);
  await expect(scheduled).toContainText('Terepes Tamás');
  await expect(events.getByRole('listitem').filter({ hasText: 'Projekt létrehozva' })).toHaveCount(1);

  // 2. Tamás (saját böngészőkontextus): ICS-link, majd „Mai kiszállásaim”.
  const tamas = await newPage(browser, info);
  await login(tamas, TEREPES);
  await openMenuItem(tamas, 'Kiszállások');
  // A terepes nem vesz fel kiszállást, de a sajátját látja.
  await expect(tamas.getByRole('button', { name: 'Kiszállás ütemezése' })).toHaveCount(0);
  await tamas.getByRole('button', { name: /link készítése/i }).click();
  const icsUrl = await tamas.getByLabel('A naptár linkje').inputValue();
  expect(icsUrl).toMatch(/\/api\/ics\/[A-Za-z0-9_-]{43}\.ics$/);

  // A feed belépés nélkül (süti nélküli kérés) letölthető, és benne a kiszállás.
  const anon = await request.newContext({ baseURL: info.project.use.baseURL });
  const feed = await anon.get(new URL(icsUrl).pathname);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('text/calendar');
  const ics = (await feed.text()).replace(/\r\n[ \t]/g, '');
  expect(ics).toContain(`SUMMARY:Kiszállás: ${projectName}`);
  expect(ics).toContain('LOCATION:Kecskemét\\, Minta utca 1.');
  await anon.dispose();

  await openMenuItem(tamas, 'Mai kiszállásaim');
  await expect(tamas.getByRole('heading', { name: 'Mai kiszállásaim' })).toBeVisible();
  if (start.date !== today) await tamas.goto(`/visits/mine?date=${start.date}`);
  // A projekt linkje szerint: egy másik (korábbi futásból maradt) kiszállás ütközés-felsorolása is említheti a nevét.
  const mine = tamas
    .getByRole('list', { name: 'Mai kiszállásaim' })
    .locator(':scope > li')
    .filter({ has: tamas.getByRole('link', { name: projectName, exact: true }) });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText(timeLabel);
  await expect(mine).toContainText('Kecskemét, Minta utca 1.');
  await expect(mine).toContainText('Légtechnikai felmérés, ventilátor');
  // A projektre kattintva az adatlap nyílik (Tamás hozzá van rendelve).
  await mine.getByRole('link', { name: projectName }).click();
  await expect(tamas.getByRole('heading', { name: projectName })).toBeVisible();
  await tamas.context().close();
});
