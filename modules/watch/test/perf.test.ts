import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, login, requester, type TestContext } from '../../../apps/server/test/helpers.ts';
import { mapLimit } from '../server/fs.ts';

// Spec, 12. munkacsomag: 10 000 fájl bejárása 60 s alatt.
const FILES = 10_000;
const LIMIT_MS = 60_000;

let ctx: TestContext;
let root: string;
let cookie: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'watch-perf-'));
  process.env.WATCH_ROOT = root;
  process.env.WATCH_INTERVAL_SEC = '0';
  ctx = await createTestApp({ DERP_MODULES: 'watch' });
  cookie = await login(ctx.app);
});
afterAll(async () => {
  await ctx.close();
  delete process.env.WATCH_ROOT;
  delete process.env.WATCH_INTERVAL_SEC;
  await rm(root, { recursive: true, force: true });
});

/** 100 almappa (két szinten) × 100 fájl a `dir` alatt. */
async function makeTree(dir: string, tag: string) {
  const items = Array.from({ length: FILES }, (_, i) => ({
    rel: path.join(`Ev${Math.floor(i / 1000)}`, `Munka ${Math.floor(i / 100) % 10}`, `${tag}-${String(i).padStart(5, '0')}.pdf`),
    body: `%PDF-1.4 ${tag} ${i} ${'x'.repeat(i % 2000)}`,
  }));
  await mapLimit(items, 64, async ({ rel, body }) => {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
  });
}

const timed = async <T>(fn: () => Promise<T>) => {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
};

describe('watch modul: 10 000 fájl', () => {
  it(`hozzárendelés (alapállapot hash-sel), változatlan újrabejárás és 10 000 új fájl eseménnyel, mind ${LIMIT_MS / 1000} s alatt`, { timeout: 4 * LIMIT_MS }, async () => {
    const api = requester(ctx.app, cookie);
    const pid = (await api('POST', '/api/projects', { name: 'Watch: 10 000 fájl' })).json().id as string;
    await makeTree(path.join(root, 'Nagy'), 'meglevo');

    const baseline = await timed(() => api('PUT', `/api/watch/projects/${pid}/mapping`, { path: 'Nagy' }));
    expect(baseline.value.statusCode).toBe(200);
    expect(baseline.value.json().mapping.fileCount).toBe(FILES);

    const rescan = await timed(() => api('POST', `/api/watch/projects/${pid}/scan`));
    expect(rescan.value.json()).toEqual({ added: 0, modified: 0, deleted: 0, renamed: 0, files: FILES, error: null });

    await makeTree(path.join(root, 'Nagy', 'Uj'), 'uj');
    const withEvents = await timed(() => api('POST', `/api/watch/projects/${pid}/scan`));
    expect(withEvents.value.json()).toMatchObject({ added: FILES, files: 2 * FILES, error: null });
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM events WHERE project_id = $1 AND type = 'watch.file_added'`, [pid]);
    expect(rows[0].n).toBe(FILES);

    console.log(
      `10 000 fájl: alapállapot ${(baseline.ms / 1000).toFixed(1)} s, változatlan újrabejárás ${(rescan.ms / 1000).toFixed(1)} s, ` +
        `10 000 új fájl eseménnyel ${(withEvents.ms / 1000).toFixed(1)} s`,
    );
    expect(baseline.ms).toBeLessThan(LIMIT_MS);
    expect(rescan.ms).toBeLessThan(LIMIT_MS);
    expect(withEvents.ms).toBeLessThan(LIMIT_MS);
  });
});
