import { defineConfig } from '@playwright/test'
import {
  FLAG_OFF_PORT,
  FLAG_ON_PORT,
  STUB_PORT,
  assertHarnessBuild,
  assertNoEnvFiles,
  harnessServerEnv,
  scrubInheritedSettings,
} from './e2e/tenancy/harness-env.mjs'

/**
 * The tenant-host harness (S5, B10a): one build served twice, routing off and
 * routing on, beside a local stand-in for PostgREST.
 *
 *   node e2e/tenancy/build-harness.mjs
 *   npx playwright test -c playwright.tenant-hosts.config.ts
 *
 * Its own config, as with Storybook: `webServer` and `globalSetup` belong to a
 * whole config, so a project in playwright.config.ts would start these servers,
 * and sign in through Clerk, on every e2e run.
 *
 * No secrets and no shared database. The stub answers every Supabase call, the
 * Clerk key belongs to no instance, and the CMS is unset, so CMS-backed pages
 * answer as they do with no CMS. What it proves is what routing does to a request
 * on the production build. It proves nothing about live data.
 */
assertNoEnvFiles()
assertHarnessBuild()
scrubInheritedSettings()

// E2E_TENANT_HOST_LOGS=1 shows what the servers print.
const serverLogs = process.env.E2E_TENANT_HOST_LOGS ? 'pipe' : 'ignore'

export default defineConfig({
  testDir: './e2e/tenancy',
  testMatch: /.*\.spec\.ts/,
  // The servers are shared and each spec compares the two of them.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A difference that only shows sometimes is still a difference.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  outputDir: 'test-results/tenant-hosts',
  timeout: 15 * 60_000,
  projects: [{ name: 'tenant-host' }],
  // Never reuse a server this run did not start: see playwright.config.ts.
  webServer: [
    {
      command: 'npx tsx e2e/tenancy/host-map-stub.ts',
      port: STUB_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx next start -p ${FLAG_OFF_PORT}`,
      port: FLAG_OFF_PORT,
      env: harnessServerEnv(false),
      // A page with no CMS logs a stack per request, thousands in a run.
      stderr: serverLogs,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${FLAG_ON_PORT}`,
      port: FLAG_ON_PORT,
      env: harnessServerEnv(true),
      stderr: serverLogs,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
