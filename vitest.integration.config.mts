import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Tests that need a real database, run by CI's tenant-db job against a
// throwaway local Supabase database (.github/workflows/ci.yml). Never part of
// `npm test`: vitest.config.mts leaves test/integration out. Each file checks
// that it is pointed at this machine before it writes anything.
export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['test/integration/**/*.int.test.ts'],
    // One database, shared fixtures: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // As in vitest.config.mts: the guard package throws outside Next's server build.
      'server-only': fileURLToPath(new URL('./test/empty-module.ts', import.meta.url)),
    },
  },
})
