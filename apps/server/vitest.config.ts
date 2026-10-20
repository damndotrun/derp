import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A mag tesztjei és a modulok szerver oldali tesztjei (`modules/<id>/test/`).
    include: ['test/**/*.test.ts', '../../modules/*/test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Közös teszt-adatbázis: a fájlok sorban futnak.
    fileParallelism: false,
  },
});
