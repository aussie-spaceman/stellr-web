import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // '**/node_modules/**' rather than 'node_modules': a git worktree under
    // .claude/worktrees/<name>/ carries its own node_modules, and the bare
    // pattern only matched the top-level one — so every third-party *.test.ts
    // in there ran and reported ~130 failing files (21 Sept 2026).
    // test/integration needs a real database: CI's tenant-db job runs it with
    // vitest.integration.config.mts.
    // .stryker-tmp/**: Stryker runs in place (stryker.config.mjs) and backs up
    // every file it rewrites, test files included, under .stryker-tmp/backup-*;
    // without this the mutation run's initial test run also ran those copies,
    // which then failed on relative paths and missing file snapshots.
    exclude: ['**/node_modules/**', '.claude/worktrees/**', '.next', 'test/integration/**', '.stryker-tmp/**'],
    // Building a jsdom per file was 44% of the suite's summed time (4 Nov 2026),
    // and most *.test.ts files never touch a DOM. Component tests (*.test.tsx)
    // keep jsdom. A *.test.ts file that needs one says so on its first line:
    // `// @vitest-environment jsdom`. `extends: true` inherits everything else
    // in this file. Without it, a project would have no setup file or aliases.
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: ['**/*.test.ts'] } },
      { extends: true, test: { name: 'dom', environment: 'jsdom', include: ['**/*.test.tsx'] } },
    ],
    // Under Stryker (stryker.config.mjs, nightly) instrumented code runs
    // up to ~20x slower, so the PDF-bomb tests outgrow the 5 s default.
    // Every normal run keeps Vitest's default.
    ...(process.env.STRYKER_MUTATOR_WORKER ? { testTimeout: 180_000 } : {}),
    // deep review TEST-10: a coverage provider (@vitest/coverage-v8) so
    // `vitest run --coverage` can report where the trust-boundary code is and
    // isn't exercised. Deliberately NO thresholds yet — coverage is only
    // computed when --coverage is passed, so the default `vitest run` gate is
    // untouched; ratchet thresholds up per directory from a measured baseline
    // in a follow-up rather than gating on a round number today.
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'app/api/**/*.ts', 'proxy.ts'],
      exclude: ['**/*.test.*', 'lib/database.types.ts', 'lib/tokens.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      '@stellr/web-ui': fileURLToPath(new URL('./packages/web-ui/src/index.ts', import.meta.url)),
      '@stellr/icons': fileURLToPath(new URL('./packages/icons/src/index.tsx', import.meta.url)),
      // The `server-only`/`client-only` guard packages throw unless the bundler
      // sets the RSC `react-server` condition (Next does; Vitest doesn't), which
      // blocks importing Server Components in tests. Stub them to a no-op here —
      // the real Next build still enforces the boundary.
      'server-only': fileURLToPath(new URL('./test/empty-module.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./test/empty-module.ts', import.meta.url)),
    },
  },
})
