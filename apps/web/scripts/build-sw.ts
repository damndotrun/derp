// A service worker fordítása a kliens buildje után (`pnpm build`): a `sw/sw.ts` egy fájlba (`dist/sw.js`), majd a
// Workbox beleírja az előre gyorsítótárazandó fájlok listáját (a `dist` tartalma, a service worker nélkül).
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { injectManifest } from 'workbox-build';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: dist,
    emptyOutDir: false,
    copyPublicDir: false,
    minify: true,
    lib: { entry: `${root}sw/sw.ts`, formats: ['iife'], name: 'derpSw', fileName: () => 'sw.js' },
  },
});

const { count, size, warnings } = await injectManifest({
  swSrc: `${dist}/sw.js`,
  swDest: `${dist}/sw.js`,
  globDirectory: dist,
  globPatterns: ['**/*.{html,js,css,svg,png,ico,webmanifest,woff2}'],
  globIgnores: ['sw.js'],
  // A buildelt fájlnevekben ott a tartalom hash-e.
  dontCacheBustURLsMatching: /^assets\//,
});
for (const w of warnings) console.warn(w);
console.log(`service worker: ${count} fájl előre gyorsítótárazva (${Math.round(size / 1024)} kB)`);
