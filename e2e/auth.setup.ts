import { test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { FIXTURES, storageStatePath, type FixtureRole } from './fixtures/users'
import { applyVercelBypass } from './fixtures/vercel-bypass'
import { signInAs } from './fixtures/sign-in'

/**
 * Sign each fixture user in once and save the session.
 *
 * Uses `@clerk/testing`, Clerk's supported path for Playwright, rather than
 * driving the sign-in form.
 *
 * Driving the form does not work, and the reason is worth recording so nobody
 * tries again: a correct password still lands on `/sign-in/factor-two`, because
 * Clerk challenges an unrecognised device with an emailed code. The six visible
 * boxes there are decorative `div`s over a single transparent input, and that
 * input accepts neither `fill()` — it is a controlled component that ignores a
 * programmatic value — nor `pressSequentially()` or `keyboard.type()` after a
 * click. Even if solved, the result would be a test coupled to Clerk's markup.
 *
 * A testing token bypasses the bot-detection and new-device challenge that
 * exists to stop precisely this kind of automation, which is why Clerk provides
 * one rather than leaving people to defeat it.
 *
 * This does not weaken what the suite proves. It authenticates as a real user in
 * the development instance and exercises this app's own session handling; it
 * skips only Clerk's login form, which is Clerk's code, not this repo's.
 *
 * The sign-in itself lives in e2e/fixtures/sign-in.ts, so a test that has to
 * end a session can make its own instead of ending this shared one.
 */

mkdirSync('e2e/.auth', { recursive: true })

for (const role of Object.keys(FIXTURES) as FixtureRole[]) {
  setup(`sign in as ${role}`, async ({ page, baseURL }) => {
    // Against a protected deployment every request is redirected to Vercel's
    // SSO page unless the bypass header rides along. Clerk then never loads and
    // the only symptom is the waitForFunction below timing out — which says
    // nothing about the cause. This setup does not use e2e/fixtures/test.ts (it
    // needs Playwright's own `test` to write storage state), so it applies the
    // same origin-scoped routing itself.
    await applyVercelBypass(page, baseURL)

    await signInAs(page, role, baseURL)

    await page.context().storageState({ path: storageStatePath(role) })
  })
}
