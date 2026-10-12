import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

// Playwright does not read .env.local the way Next does, so nothing in it would
// reach the suite otherwise — the bypass token and the fixture passwords would
// silently be undefined. process.loadEnvFile is built into Node 20.12+, so this
// needs no dependency. Real environment variables still win, which is what lets
// CI pass secrets without a file.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

// deep review TEST-6: locally there is usually no ESIGN_TOKEN_SECRET, so the
// consent-signing / privacy / survey / family-link specs silently SKIP and the
// run still reports green — training developers to trust a pass that proved
// nothing. CI already generates one per run; mirror that here. A per-run random
// secret only has to sign the links this same run mints, so it needs no setup.
// Real values (CI, or a developer's own) still win via ??=.
process.env.ESIGN_TOKEN_SECRET ??= randomBytes(32).toString('hex')

// A plain local `playwright test`: our own dev server, no E2E_BASE_URL. The
// coordinator's runs showed `next dev` with the default worker count producing
// transient 404s under parallel cold-compile (21 of 26 minors specs failed as
// harness artefacts, not app bugs). Cap workers and offer an E2E_PROD mode that
// serves the production build, which was 0-flaky.
const localDev = !process.env.CI && !process.env.E2E_BASE_URL && !process.env.E2E_PROD

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

  // TEST-6: fewer workers locally on `next dev` so parallel cold compiles don't
  // surface as transient 404s. CI, E2E_BASE_URL and E2E_PROD keep the default.
  workers: localDev ? 2 : undefined,

  // `.only` left in a file silently narrows CI to one test and reports green.
  forbidOnly: !!process.env.CI,

  // One retry in CI absorbs runner noise (cold caches, a slow cold start).
  // Locally zero, so a flake is visible the moment it is introduced rather than
  // hidden until the statistics turn.
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    // Vercel's bypass headers are NOT set here. use.extraHTTPHeaders applies to
    // every origin, and fonts.gstatic.com and clerk.accounts.dev reject the
    // unexpected header in CORS preflight — so fonts and the Clerk SDK fail to
    // load and every page logs console errors that look like an app regression.
    // e2e/fixtures/test.ts scopes them to the host under test instead.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Generous: the first request to a cold Vercel preview pays a lambda start.
    // CI runners are cold: no warm DNS, no cached third-party scripts, and a
    // freshly started server. Doubling these there costs nothing on a passing
    // run — a timeout only elapses when something is already wrong.
    actionTimeout: process.env.CI ? 30_000 : 15_000,
    navigationTimeout: process.env.CI ? 60_000 : 30_000,
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
        // CI builds first and serves the production output: that is what
        // deploys, and a dev-server-only suite would miss anything differing
        // between them. Locally `npm run dev` keeps the fast loop and claims a
        // free port per worktree via scripts/dev.mjs. TEST-6: E2E_PROD serves
        // the production build locally too (0-flaky in the coordinator's runs),
        // for confirming a failure is the app, not the dev-server harness.
        command: process.env.CI || process.env.E2E_PROD ? 'npm start' : 'npm run dev',
        port: PORT,
        // TEST-6: hand the server the same signing secret the specs use, so the
        // minors journeys run instead of skipping when .env.local has none.
        env: { ESIGN_TOKEN_SECRET: process.env.ESIGN_TOKEN_SECRET! },
        // Never reuse a server this run did not start.
        //
        // WHY (10 Sept 2026): the obvious version of this — reuse only when the
        // worktree has claimed a PORT — does not work, because the claimed port
        // is usually 3000, which is exactly the port a sibling worktree's server
        // is already on. Playwright attached to it and the whole suite ran
        // against another branch's code with another branch's environment. On
        // the run that exposed this, localhost:3000 was serving a pk_live_
        // Clerk build: the specs were talking to PRODUCTION credentials.
        //
        // There is no way to ask Playwright "is this server mine?", so the only
        // safe answer is to always start our own. If the port is occupied the
        // run fails immediately with a port-in-use error, which is a good
        // outcome: loud, instant, and impossible to mistake for a test result.
        //
        // Cost is a few seconds of startup per run. The alternative cost is a
        // green suite that proves nothing, which this repo has now paid three
        // times.
        reuseExistingServer: false,
        timeout: 180_000,
      },
})
