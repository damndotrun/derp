import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Közös teszt-adatbázis: a fájlok sorban futnak.
    fileParallelism: false,
  },
});
