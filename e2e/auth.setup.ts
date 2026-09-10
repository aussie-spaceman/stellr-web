import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { FIXTURES, storageStatePath, type FixtureRole } from './fixtures/users'

/**
 * Sign each fixture user in once and save the session.
 *
 * Signing in per spec would dominate the suite's runtime and put load on Clerk
 * for no benefit. This runs as its own project, and `core` declares it as a
 * dependency, so it happens once per run.
 *
 * The fixture users are Clerk `+clerk_test` addresses on the development
 * instance, which is what lets this work without an inbox: Clerk does not send
 * mail for them and accepts a fixed verification code.
 */

mkdirSync('e2e/.auth', { recursive: true })

for (const role of Object.keys(FIXTURES) as FixtureRole[]) {
  const fixture = FIXTURES[role]

  setup(`sign in as ${role}`, async ({ page }) => {
    const password = process.env[fixture.passwordVar]
    if (!password) {
      throw new Error(
        `${fixture.passwordVar} is not set — cannot sign in as ${role}.\n` +
          'These are the passwords you set when creating the fixture users in\n' +
          "Clerk's development instance. Add them to .env.local.",
      )
    }

    await page.goto('/sign-in')

    // Role and label, not CSS: this repository regenerates Tailwind classes
    // from design tokens, so any class-based selector rots on the next token
    // change while the accessible name does not.
    await page.getByLabel(/email/i).fill(fixture.email)
    await page.getByRole('button', { name: /continue|sign in/i }).click()

    await page.getByLabel(/password/i).fill(password)
    await page.getByRole('button', { name: /continue|sign in/i }).click()

    // Wait for a real signed-in signal rather than a timeout. Landing anywhere
    // that is not /sign-in means Clerk accepted the credentials.
    await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 30_000 })

    await page.context().storageState({ path: storageStatePath(role) })
  })
}
