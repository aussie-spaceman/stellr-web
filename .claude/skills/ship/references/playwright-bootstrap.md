# Playwright bootstrap (first run only)

This repo has vitest (`npm run test`) for unit tests and **no E2E layer**. Set
this up once, as its own commit, before the first `ship` run that needs E2E.
Ask the user before installing — it adds a dependency and a browser download.

## Install

```bash
npm i -D @playwright/test && npx playwright install --with-deps chromium
```

Add to `package.json` scripts:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

## `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Playwright owns the dev server — never start one with Bash.
  // Skipped when E2E_BASE_URL points at a deployed preview.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
```

Add to `.gitignore`:

```
test-results/
playwright-report/
/blob-report/
.playwright/
```

## Smoke spec — `e2e/smoke.spec.ts`

```ts
import { expect, test } from '@playwright/test'

test('home renders the hero', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('events index lists events', async ({ page }) => {
  await page.goto('/events')
  await expect(page).toHaveTitle(/events/i)
})

test('no console errors on home', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/')
  expect(errors).toEqual([])
})
```

## Conventions

- One spec file per user-facing flow, named for the flow (`e2e/enrolment.spec.ts`).
- Select by **role and accessible name** (`getByRole`, `getByLabel`). Never by
  Tailwind class — token classes change when the design system does.
- No `waitForTimeout`. Use web-first assertions (`toBeVisible`, `toHaveURL`),
  which retry on their own.
- **Authenticated flows** need Clerk. Use a dedicated test user from
  `.env.local` and a `storageState` fixture; never hard-code credentials in a
  spec, and never commit a `storageState` file.
- **External services** (Sanity, HubSpot, DocuSign, Supabase writes): stub with
  `page.route()` rather than hitting a real API from a test run.
- Env: E2E needs `.env.local` populated — see `.env.local.example`.

## Running against a Vercel preview

```bash
E2E_BASE_URL=https://<preview>.vercel.app npx playwright test
```

Skips the local `webServer` and tests the real deployment. Use this in Phase 5
to smoke production after a merge — but only read-only specs; do not run specs
that write to production data.
