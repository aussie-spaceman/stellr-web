import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// Playwright does not read .env.local the way Next does, so nothing in it would
// reach the suite otherwise — the bypass token and the fixture passwords would
// silently be undefined. process.loadEnvFile is built into Node 20.12+, so this
// needs no dependency. Real environment variables still win, which is what lets
// CI pass secrets without a file.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

/**
 * Playwright configuration.
 *
 * Runs against one of three targets, in order of preference:
 *
 *   E2E_BASE_URL set   → that URL (a Vercel preview, or the dev deployment)
 *   otherwise          → a dev server this config starts on PORT
 *
 * Never point this at production. The suite signs in as fixture members and
 * writes rows; against production that would create real members and mail real
 * people. `globalSetup` refuses a production URL outright rather than trusting
 * anyone to remember.
 */
const PORT = Number(process.env.PORT ?? 3000)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',

  // A spec that only passes when run alone is a spec that will fail in CI.
  fullyParallel: true,

  // `.only` left in a file silently narrows CI to one test and reports green.
  forbidOnly: !!process.env.CI,

  // One retry in CI absorbs runner noise (cold caches, a slow cold start).
  // Locally zero, so a flake is visible the moment it is introduced rather than
  // hidden until the statistics turn.
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    // Vercel Deployment Protection guards the dev project. Without this header
    // every request is redirected to a Vercel login page — and a suite that
    // asserts against a login page reports green while testing nothing, which
    // is exactly what happened on 10 Sept. e2e/global-setup.ts now fails the
    // run rather than letting that recur.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : {},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Generous: the first request to a cold Vercel preview pays a lambda start.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Public pages need no session, so they run without the auth setup.
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // Signs the fixture users in once and saves their storage state, rather
    // than each spec paying a full sign-in.
    {
      name: 'auth',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'core',
      testMatch: /core\/.*\.spec\.ts/,
      dependencies: ['auth'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Started only when testing locally; skipped when E2E_BASE_URL names a
  // deployment. `reuseExistingServer` locally so a dev server already running on
  // this worktree's port is used rather than fought over — the same collision
  // Phase 3 addressed.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
