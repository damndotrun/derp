import { expect, request, test, type APIRequestContext, type Browser, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

// 8. munkacsomag: terepi mód (PWA, offline), Pixel 7 nézetben. Terepes Tamás a „Mai kiszállásaim”-at nézi, a telefon
// offline-ra vált: az oldal újratöltve is megnyílik a tárolt kiszállással; Tamás 2 fotóval kitölt egy felmérést, ír a
// chatbe és a dokumentumtárba is fotózik. A felület „3 elem vár feltöltésre” jelzést mutat (a felmérés a fotóival egy
// elem). Online-ra váltva 30 s-on belül minden a szerveren van, a felvétel sorrendjében és a terepi időponttal; Ildinél
// a chat-üzenet újratöltés nélkül megjelenik. A sor kétszeri lejátszása sem duplikál; 401-re a sor megmarad, és a
// felület belépést kér.

const IRODA = 'iroda@derp.test';
const TEREPES = 'terepes@derp.test';
const ADMIN = 'admin@derp.test';
const QUESTION = 'Melyik gyártmányú legyen a ventilátor?';

test.skip(({ isMobile }) => !isMobile, 'A terepi mód ellenőrzése Pixel 7 nézetben fut.');

interface EventItem {
  id: string;
  type: string;
  title: string;
  occurredAt: string;
  parentId: string | null;
  data: Record<string, unknown>;
}

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

/** Második böngésző-kontextus ugyanazzal az eszköz-beállítással. */
async function secondPage(browser: Browser, info: TestInfo, baseURL: string): Promise<Page> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId });
  return context.newPage();
}

/** Projekt Tamással, és egy mai kiszállás neki (most kezdődik, fél óráig tart). */
async function setup(baseURL: string, label: string, info: TestInfo) {
  const iroda = await apiAs(baseURL, IRODA);
  const project = (await (await iroda.post('/api/projects', { data: { name: `${label} (${info.project.name} ${Date.now()})` } })).json()) as {
    id: string;
    name: string;
  };
  const users = (await (await iroda.get('/api/users')).json()) as { items: Array<{ id: string; email: string }> };
  const tamas = users.items.find((u) => u.email === TEREPES)!.id;
  expect((await iroda.put(`/api/projects/${project.id}/members/${tamas}`)).status()).toBe(204);
  const start = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const visit = await iroda.post('/api/visits', {
    data: {
      projectId: project.id,
      assigneeIds: [tamas],
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      address: 'Kecskemét, Fő utca 1.',
      task: 'Légtechnikai felmérés',
    },
  });
  expect(visit.status()).toBe(201);
  return { iroda, project, tamas, start };
}

const jpeg = (r: number, g: number, b: number) => sharp({ create: { width: 1200, height: 900, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();

/** A böngésző offline sora (IndexedDB) nyersen: az elemek, ahogy a telefonon vannak. */
const outboxItems = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ seq: number; kind: string; id: string; state: string }>>((resolve, reject) => {
        const open = indexedDB.open('derp-outbox');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction('items').objectStore('items').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as Array<{ seq: number; kind: string; id: string; state: string }>);
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );

/**
 * Offline kapcsoló: `setOffline` (a böngésző offline-nak látszik, az oldal kérései elbuknak), és a service worker
 * saját hálózati kérései is elbuknak. Utóbbihoz útvonal-szintű megszakítás kell, mert a Playwright offline-emulációja
 * az oldal újratöltésekor (újrainduló service worker-munkamenet) a service workerre nem mindig hat.
 */
async function offlineSwitch(page: Page): Promise<(offline: boolean) => Promise<void>> {
  let offline = false;
  await page.context().route('**/*', (route) => (offline && route.request().serviceWorker() ? route.abort('internetdisconnected') : route.fallback()));
  return async (value) => {
    offline = value;
    await page.context().setOffline(value);
  };
}

/** A service worker irányítja az oldalt, és a terepi tár feltöltődött (a „Mai kiszállásaim” és a projekt adatai). */
async function waitForOfflineReady(page: Page, projectId: string) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const cache = await caches.open('derp-api');
          const urls = ['/api/visits/mine', `/api/projects/${id}`, `/api/notes/projects/${id}`, `/api/chat/projects/${id}/messages`, `/api/docs/projects/${id}`];
          return (await Promise.all(urls.map((u) => cache.match(u)))).every(Boolean);
        }, projectId),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test('offline: 2 fotó + felmérés + chat + fotó a dokumentumtárba → online-ra váltva 30 s-on belül a szerveren, sorrendben, a terepi időponttal; kétszer lejátszva sem duplikál', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const { iroda, project, tamas } = await setup(baseURL!, 'Terepi mód', info);

  // Ildi a projekt chatjét nézi (másik eszköz, végig online).
  const ildi = await secondPage(browser, info, baseURL!);
  await login(ildi, IRODA);
  await ildi.goto(`/chat/${project.id}`);
  await expect(ildi.getByText('Még nincs üzenet. Írd meg az elsőt!')).toBeVisible();

  // Tamás online belép, és a „Mai kiszállásaim” mutatja a kiszállást.
  const setOffline = await offlineSwitch(page);
  await login(page, TEREPES);
  await page.goto('/visits/mine');
  const mine = page.getByRole('list', { name: 'Mai kiszállásaim' });
  await expect(mine.getByRole('link', { name: project.name })).toBeVisible();
  await waitForOfflineReady(page, project.id);

  // Offline. Közben Ildi még egy kiszállást ütemez Tamásnak: az offline oldal a tárolt állapotot mutatja.
  await setOffline(true);
  const offlineAt = Date.now();
  const later = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 5 * 60_000);
  const other = (await (
    await iroda.post('/api/projects', { data: { name: `Másik projekt offline közben (${Date.now()})` } })
  ).json()) as { id: string; name: string };
  expect((await iroda.put(`/api/projects/${other.id}/members/${tamas}`)).status()).toBe(204);
  expect(
    (await iroda.post('/api/visits', { data: { projectId: other.id, assigneeIds: [tamas], startsAt: later.toISOString(), endsAt: new Date(later.getTime() + 600_000).toISOString() } })).status(),
  ).toBe(201);

  // Az alkalmazás térerő nélkül is megnyílik, a „Mai kiszállásaim” a telefonon tárolt adatból.
  await page.reload();
  await expect(mine.getByRole('link', { name: project.name })).toBeVisible();
  await expect(mine.getByRole('link', { name: other.name })).toHaveCount(0);
  const status = page.getByRole('region', { name: 'Terepi szinkron' });
  await expect(status.getByText('Nincs kapcsolat.')).toBeVisible();

  // Felmérés 2 fotóval.
  await page.goto(`/notes/${project.id}`);
  await page.getByRole('button', { name: '+ Új felmérés' }).click();
  const form = page.getByRole('form', { name: 'Új felmérés' });
  await form.getByLabel('Helyszín *').fill('Gépház, tető');
  await form.getByLabel('Észlelt állapot *').fill('A ventilátor csapágya zajos.');
  await form.getByLabel('Javasolt munka *').fill('Ventilátorcsere.');
  await form.getByLabel('Megnevezés 1').fill('Radiálventilátor');
  await form.getByLabel('Mennyiség 1').fill('1');
  await form.getByLabel('Fotók hozzáadása').setInputFiles([
    { name: 'terep-1.jpg', mimeType: 'image/jpeg', buffer: await jpeg(30, 120, 160) },
    { name: 'terep-2.jpg', mimeType: 'image/jpeg', buffer: await jpeg(160, 90, 30) },
  ]);
  await expect(form.getByRole('list', { name: 'Fotók' }).getByRole('listitem')).toHaveCount(2);
  await form.getByRole('button', { name: 'Felmérés mentése' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Felmérés: Gépház, tető (feltöltésre vár)' })).toBeVisible();
  await expect(status.getByText('1 elem vár feltöltésre')).toBeVisible();

  // Kérdés a chatben.
  await page.goto(`/chat/${project.id}`);
  const composer = page.getByRole('textbox', { name: 'Üzenet' });
  await composer.fill(QUESTION);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Üzenetek' }).getByRole('article', { name: `Terepes Tamás: ${QUESTION}` })).toContainText('feltöltésre vár');

  // Fotó a dokumentumtárba.
  await page.goto(`/docs/${project.id}`);
  await page.getByLabel('Fotó készítése').setInputFiles([{ name: 'terep-3.jpg', mimeType: 'image/jpeg', buffer: await jpeg(90, 160, 30) }]);
  await expect(page.getByRole('list', { name: 'Feltöltések' }).getByText('Feltöltésre vár')).toBeVisible();

  await expect(status.getByText('3 elem vár feltöltésre')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const queued = await outboxItems(page);
  expect(queued.map((i) => i.kind)).toEqual(['notes.survey', 'chat.message', 'docs.upload']);

  // A sor másolata a második lejátszáshoz (ugyanazok az elemek, ugyanazokkal az azonosítókkal).
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('derp-outbox');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('items').objectStore('items').getAll();
          all.onsuccess = () => {
            (window as unknown as { __outboxCopy: unknown[] }).__outboxCopy = all.result;
            open.result.close();
            resolve();
          };
        };
      }),
  );

  // Online: 30 s-on belül minden a szerveren.
  await page.waitForTimeout(1_500);
  const onlineAt = Date.now();
  await setOffline(false);
  await expect(status.getByText(/elem vár feltöltésre/)).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await outboxItems(page)).length, { timeout: 30_000 }).toBe(0);
  expect(Date.now() - onlineAt).toBeLessThan(30_000);

  // Ildinél a kérdés újratöltés nélkül megjelenik.
  await expect(ildi.getByRole('list', { name: 'Üzenetek' }).getByRole('article', { name: `Terepes Tamás: ${QUESTION}` })).toBeVisible();

  // Az események a terepi időponttal (az offline szakaszban, nem a feltöltéskor), a felvétel sorrendjében; a felmérés
  // fotói a felmérés alatt.
  const events = async () => ((await (await iroda.get(`/api/projects/${project.id}/events?limit=100`)).json()) as { items: EventItem[] }).items;
  const all = await events();
  const survey = all.find((e) => e.type === 'notes.survey_added')!;
  const surveyPhotos = all.filter((e) => e.type === 'docs.file_uploaded' && e.parentId === survey.id);
  const message = all.find((e) => e.type === 'chat.message_posted')!;
  const docsPhoto = all.find((e) => e.type === 'docs.file_uploaded' && e.parentId === null)!;
  expect(survey.title).toBe('Felmérés: Gépház, tető');
  expect(surveyPhotos.map((e) => e.title).sort()).toEqual(['Fotó feltöltve: terep-1.jpg', 'Fotó feltöltve: terep-2.jpg']);
  expect(message.title).toBe(`Chat-üzenet: ${QUESTION}`);
  expect(docsPhoto.title).toBe('Fotó feltöltve: terep-3.jpg');
  const at = (e: EventItem) => Date.parse(e.occurredAt);
  for (const e of [survey, ...surveyPhotos, message, docsPhoto]) {
    expect(at(e)).toBeGreaterThanOrEqual(offlineAt - 1_000);
    expect(at(e)).toBeLessThan(onlineAt);
  }
  expect(surveyPhotos.every((e) => at(e) === at(survey))).toBe(true);
  expect(at(survey)).toBeLessThan(at(message));
  expect(at(message)).toBeLessThan(at(docsPhoto));

  // A szerverre érkezés sorrendje is a felvételé (az auditnapló sorszáma szerint).
  const admin = await apiAs(baseURL!, ADMIN);
  const audit = (await (await admin.get(`/api/audit?projectId=${project.id}&action=create&limit=50`)).json()) as {
    items: Array<{ id: number; entityType: string; label: string }>;
  };
  const arrival = audit.items
    .filter((a) => ['notes.survey', 'docs.file', 'chat.message'].includes(a.entityType))
    .sort((a, b) => a.id - b.id)
    .map((a) => `${a.entityType}:${a.label}`);
  expect(arrival.slice(0, 3)).toEqual(['notes.survey:Gépház, tető', expect.stringMatching(/^docs\.file:terep-[12]\.jpg$/), expect.stringMatching(/^docs\.file:terep-[12]\.jpg$/)]);
  expect(arrival.slice(3)).toEqual([`chat.message:${QUESTION}`, 'docs.file:terep-3.jpg']);

  // A sor kétszeri lejátszása: ugyanazok az elemek újra a sorba, az alkalmazás újranyitva lejátssza őket.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const copy = (window as unknown as { __outboxCopy: Array<Record<string, unknown>> }).__outboxCopy;
        const open = indexedDB.open('derp-outbox');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('items', 'readwrite');
          for (const { seq: _seq, ...item } of copy) tx.objectStore('items').add({ ...item, state: 'waiting' });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(await outboxItems(page)).toHaveLength(3);
  await page.reload();
  await expect.poll(async () => (await outboxItems(page)).length, { timeout: 30_000 }).toBe(0);
  const again = await events();
  expect(again.map((e) => e.id).sort()).toEqual(all.map((e) => e.id).sort());
  const messages = (await (await iroda.get(`/api/chat/projects/${project.id}/messages`)).json()) as { items: unknown[] };
  expect(messages.items).toHaveLength(1);
  const notes = (await (await iroda.get(`/api/notes/projects/${project.id}`)).json()) as { surveys: unknown[] };
  expect(notes.surveys).toHaveLength(1);
  const docs = (await (await iroda.get(`/api/docs/projects/${project.id}`)).json()) as { files: unknown[] };
  expect(docs.files).toHaveLength(3);

  // Az idővonalon a felmérés és a fotói egy csoportban.
  await page.goto(`/projects/${project.id}`);
  const surveyRow = page.getByRole('list', { name: 'Események' }).locator('li[data-event-type="notes.survey_added"]');
  await expect(surveyRow).toContainText('Felmérés: Gépház, tető');
  await expect(surveyRow.getByRole('button', { name: /2 kapcsolódó/ })).toBeVisible();

  await Promise.all([iroda.dispose(), admin.dispose(), ildi.context().close()]);
});

test('401 válaszra a sor megmarad, a felület belépést kér; belépés után feltöltődik', async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  const { iroda, project } = await setup(baseURL!, 'Terepi 401', info);
  const setOffline = await offlineSwitch(page);
  await login(page, TEREPES);
  await page.goto(`/chat/${project.id}`);
  await expect(page.getByText('Még nincs üzenet. Írd meg az elsőt!')).toBeVisible();

  // Offline üzenet; közben a munkamenet lejár (a szerveren kilép).
  await setOffline(true);
  const composer = page.getByRole('textbox', { name: 'Üzenet' });
  await composer.fill('Lejárt munkamenet alatt írva');
  await composer.press('Enter');
  const status = page.getByRole('region', { name: 'Terepi szinkron' });
  await expect(status.getByText('1 elem vár feltöltésre')).toBeVisible();
  expect((await page.request.post('/api/logout')).status()).toBe(204);

  // Online: a küldés 401-et kap, az elem a telefonon marad, a felület a belépő oldalra visz és jelzi a várakozó elemet.
  await setOffline(false);
  await expect(page.getByText('1 elem vár feltöltésre ezen az eszközön; belépés után (ugyanazzal a fiókkal) feltöltődik.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Belépés (fejlesztői)' })).toBeVisible();
  expect((await outboxItems(page)).map((i) => i.kind)).toEqual(['chat.message']);
  const none = (await (await iroda.get(`/api/chat/projects/${project.id}/messages`)).json()) as { items: unknown[] };
  expect(none.items).toHaveLength(0);

  // Újra belépve az elem feltöltődik (egyszer).
  await page.getByLabel('E-mail-cím').fill(TEREPES);
  await page.getByRole('button', { name: 'Belépés (fejlesztői)' }).click();
  await expect(page.getByRole('heading', { name: 'Projektek' })).toBeVisible();
  await expect.poll(async () => (await outboxItems(page)).length, { timeout: 30_000 }).toBe(0);
  const sent = (await (await iroda.get(`/api/chat/projects/${project.id}/messages`)).json()) as { items: Array<{ body: string }> };
  expect(sent.items.map((m) => m.body)).toEqual(['Lejárt munkamenet alatt írva']);
  await iroda.dispose();
});

test('a manifest és a service worker elérhető (telepíthető PWA)', async ({ page }) => {
  await page.goto('/login');
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const m = (await manifest.json()) as { name: string; display: string; start_url: string; icons: Array<{ sizes: string; purpose?: string }> };
  expect(m).toMatchObject({ name: 'dERP', display: 'standalone', start_url: '/' });
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png']) {
    expect((await page.request.get(icon)).headers()['content-type']).toBe('image/png');
  }
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 15_000 })
    .toBe('activated');
});
