import { defineConfig, devices } from '@playwright/test';

// Ha E2E_BASE_URL meg van adva (pl. compose `e2e` profil vagy NAS porttovábbítással), arra fut, és a
// tesztadatokat (`pnpm seed:e2e`) a futtató tölti be. Ha nincs, a Playwright maga indít egy szervert a
// DATABASE_URL adatbázisra, NODE_ENV=test és DEV_LOGIN=1 mellett.
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? 'http://localhost:8080';

// Előre telepített Chromium használata (pl. felhős munkamenetben), ha a Playwright saját böngészője nincs letöltve.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: '.',
  // A mag saját tesztjei, a modulok saját tesztjei és a közös forgatókönyv (16. munkacsomag).
  testMatch: ['apps/web/e2e/**/*.spec.ts', 'modules/*/e2e/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  testIgnore: ['**/node_modules/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'hu-HU',
    timezoneId: 'Europe/Budapest',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'asztali', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'pnpm build && pnpm seed:e2e && pnpm start',
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NODE_ENV: 'test',
          DEV_LOGIN: '1',
          SESSION_SECRET: process.env.SESSION_SECRET ?? 'e2e-only-session-secret-0123456789abcdef',
        },
      },
});
