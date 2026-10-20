import { expect, request, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

// 5. munkacsomag: jegyzet és felmérés. A tesztfelhasználók a `pnpm seed:e2e`-ből (Iroda Ildi, Terepes Tamás).

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

const jpeg = (r: number, g: number, b: number) =>
  sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();

type EventItem = { id: string; type: string; title: string; parentId: string | null };

test('felmérés 2 fotóval → az idővonalon egy csoportban (a fotó-események parentId-vel a felmérésre mutatnak)', async ({ page, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Felmérés próba', info, true);

  // Tamás a projekt-adatlapról nyitja a jegyzeteket és felméréseket.
  await login(page, TEREPES);
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('navigation', { name: 'A projekt oldalai' }).getByRole('link', { name: 'Jegyzet és felmérés' }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${project.id}$`));
  await expect(page.getByText('Ehhez a projekthez még nincs jegyzet vagy felmérés.')).toBeVisible();

  await page.getByRole('button', { name: '+ Új felmérés' }).click();
  const form = page.getByRole('form', { name: 'Új felmérés' });

  // Kötelező mezők nélkül nem menthető.
  await form.getByRole('button', { name: 'Felmérés mentése' }).click();
  await expect(form.getByRole('alert')).toHaveText('Töltsd ki a kötelező mezőket.');

  await form.getByLabel('Helyszín *').fill('Gépház, 2. emelet');
  await form.getByLabel('Észlelt állapot *').fill('A légkezelő ventilátora zajos, a szűrő eltömődött.');
  await form.getByLabel('Javasolt munka *').fill('Ventilátorcsere és szűrőcsere.');
  await form.getByLabel('Megnevezés 1').fill('Radiálventilátor');
  await form.getByLabel('Mennyiség 1').fill('1');
  await form.getByRole('button', { name: '+ Tétel hozzáadása' }).click();
  await form.getByLabel('Megnevezés 2').fill('Zsákos szűrő F7');
  await form.getByLabel('Mennyiség 2').fill('2,5');
  await form.getByLabel('Egység 2').fill('m²');
  await form.getByLabel('Fotók hozzáadása').setInputFiles([
    { name: 'gephaz-1.jpg', mimeType: 'image/jpeg', buffer: await jpeg(30, 120, 160) },
    { name: 'gephaz-2.jpg', mimeType: 'image/jpeg', buffer: await jpeg(160, 90, 30) },
  ]);
  await expect(form.getByRole('list', { name: 'Fotók' }).getByRole('listitem')).toHaveCount(2);
  await form.getByRole('button', { name: 'Felmérés mentése' }).click();

  // A felmérés a listában, a mezőkkel, a tételekkel és a két fotó bélyegképével.
  const card = page.getByRole('list', { name: 'Felmérések és jegyzetek' }).getByRole('article', { name: 'Felmérés: Gépház, 2. emelet' });
  await expect(card).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(card.getByText('Ventilátorcsere és szűrőcsere.')).toBeVisible();
  await expect(card.getByRole('row', { name: /Zsákos szűrő F7 2,5 m²/ })).toBeVisible();
  for (const name of ['gephaz-1.jpg', 'gephaz-2.jpg']) {
    const img = card.getByRole('img', { name });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  // Az API szerint a két fotó eseménye a felmérés eseményére mutat.
  const events = ((await (await page.request.get(`/api/projects/${project.id}/events`)).json()) as { items: EventItem[] }).items;
  const survey = events.find((e) => e.type === 'notes.survey_added')!;
  expect(survey.title).toBe('Felmérés: Gépház, 2. emelet');
  const photos = events.filter((e) => e.type === 'docs.file_uploaded');
  expect(photos.map((e) => e.title).sort()).toEqual(['Fotó feltöltve: gephaz-1.jpg', 'Fotó feltöltve: gephaz-2.jpg']);
  expect(photos.every((e) => e.parentId === survey.id)).toBe(true);

  // Az idővonalon egy csoportban: összecsukva a felmérés „2 kapcsolódó” gombbal, kibontva alatta a két fotó.
  await page.goto(`/projects/${project.id}`);
  const timeline = page.getByRole('list', { name: 'Események' });
  const surveyRow = timeline.locator('li[data-event-type="notes.survey_added"]');
  await expect(surveyRow).toContainText('Felmérés: Gépház, 2. emelet');
  await expect(surveyRow).toContainText('Észlelt állapot: A légkezelő ventilátora zajos, a szűrő eltömődött.');
  await expect(surveyRow).toContainText('2 anyagtétel · 2 fotó');
  const related = surveyRow.getByRole('button', { name: /2 kapcsolódó/ });
  await expect(related).toHaveAttribute('aria-expanded', 'false');
  await expect(timeline.getByText('Fotó feltöltve: gephaz-1.jpg')).toHaveCount(0);
  await related.click();
  await expect(related).toHaveAttribute('aria-expanded', 'true');
  const photoRows = timeline.locator('li[data-event-type="docs.file_uploaded"]');
  await expect(photoRows).toHaveCount(2);
  await expect(timeline.getByText('Fotó feltöltve: gephaz-1.jpg')).toBeVisible();
  await expect(timeline.getByText('Fotó feltöltve: gephaz-2.jpg')).toBeVisible();
  // A fotók közvetlenül a felmérés alatt, beljebb húzva (egy csoport).
  const rows = timeline.locator(':scope > li');
  const types = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-event-type')));
  const at = types.indexOf('notes.survey_added');
  expect(types.slice(at, at + 3)).toEqual(['notes.survey_added', 'docs.file_uploaded', 'docs.file_uploaded']);

  // Az idővonal linkje a felmérés oldalára visz.
  await surveyRow.getByRole('link', { name: 'Felmérés megnyitása' }).click();
  await expect(page.getByRole('article', { name: 'Felmérés: Gépház, 2. emelet' }).getByRole('img', { name: 'gephaz-2.jpg' })).toBeVisible();

  // A fotók a dokumentumtár „Felmérések” mappájában.
  const docs = (await (await page.request.get(`/api/docs/projects/${project.id}`)).json()) as {
    folders: Array<{ id: string; name: string }>;
    files: Array<{ name: string; folderId: string | null }>;
  };
  const folder = docs.folders.find((f) => f.name === 'Felmérések')!;
  expect(docs.files.filter((f) => f.folderId === folder.id).map((f) => f.name).sort()).toEqual(['gephaz-1.jpg', 'gephaz-2.jpg']);
});

test('helyszíni jegyzet: mentés után a listában és az idővonalon', async ({ page, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Jegyzet próba', info, false);
  await login(page, IRODA);
  await page.goto(`/notes/${project.id}`);
  await page.getByRole('button', { name: '+ Új jegyzet' }).click();
  const form = page.getByRole('form', { name: 'Új jegyzet' });
  await form.getByLabel('Jegyzet *').fill('A kapukód 1234, a gondnok délután van bent.');
  await form.getByRole('button', { name: 'Jegyzet mentése' }).click();
  await expect(page.getByRole('list', { name: 'Felmérések és jegyzetek' }).getByText('A kapukód 1234, a gondnok délután van bent.')).toBeVisible();

  await page.goto(`/projects/${project.id}`);
  const row = page.getByRole('list', { name: 'Események' }).locator('li[data-event-type="notes.note_added"]');
  await expect(row).toContainText('Helyszíni jegyzet: A kapukód 1234, a gondnok délután van bent.');
});

test('a terepes nem látja a nem hozzá rendelt projekt jegyzeteit és felméréseit', async ({ page, baseURL }, info) => {
  const project = await createProject(baseURL!, 'Felmérés tiltott', info, false);
  await login(page, TEREPES);
  await page.goto(`/notes/${project.id}`);
  await expect(page.getByRole('alert')).toHaveText('Nincs jogosultság ehhez a projekthez.');
  expect((await page.request.get(`/api/notes/projects/${project.id}`)).status()).toBe(403);
  await page.goto('/notes');
  await expect(page.getByRole('list', { name: 'Projektek' }).getByText(project.name)).toHaveCount(0);
});
