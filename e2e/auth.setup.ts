import { test as setup } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { mkdirSync } from 'node:fs'
import { FIXTURES, storageStatePath, type FixtureRole } from './fixtures/users'

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
 */

/**
 * Clerk's fixed code for `+clerk_test` addresses on a development instance. Not
 * a secret: identical across every Clerk dev instance, and only accepted for
 * test users — which is what makes an inbox-free sign-in possible.
 */
const CLERK_TEST_CODE = '424242'

mkdirSync('e2e/.auth', { recursive: true })

for (const role of Object.keys(FIXTURES) as FixtureRole[]) {
  const fixture = FIXTURES[role]

  setup(`sign in as ${role}`, async ({ page, baseURL }) => {
    const password = process.env[fixture.passwordVar]
    if (!password) {
      throw new Error(
        `${fixture.passwordVar} is not set — cannot sign in as ${role}.\n` +
          'These are the passwords set when the fixture users were created in\n' +
          "Clerk's development instance. Add them to .env.local.",
      )
    }

    // Must precede the first navigation: it installs the token the Clerk client
    // picks up on load.
    await setupClerkTestingToken({ page })

    // The app's own pages, not /sign-in: clerk.signIn drives the Clerk client
    // directly and the sign-in route's own component competes with it.
    await page.goto('/')

    await clerk.signIn({
      page,
      signInParams: { strategy: 'password', identifier: fixture.email, password },
    })

    // Clerk challenges an unrecognised device with an emailed code, and the
    // testing token does not bypass that — it stops bot detection, not the
    // second factor. `+clerk_test` addresses accept a fixed code, so complete
    // it through the Clerk client rather than its six-box UI.
    await page.evaluate(async (code) => {
      const clerkClient = (window as {
        Clerk?: {
          client?: {
            signIn?: {
              status?: string
              prepareSecondFactor: (o: { strategy: string }) => Promise<unknown>
              attemptSecondFactor: (o: { strategy: string; code: string }) => Promise<unknown>
            }
          }
          setActive?: (o: { session: unknown }) => Promise<void>
        }
      }).Clerk
      const signIn = clerkClient?.client?.signIn
      if (signIn?.status !== 'needs_second_factor') return

      await signIn.prepareSecondFactor({ strategy: 'email_code' }).catch(() => {})
      const result = (await signIn.attemptSecondFactor({
        strategy: 'email_code',
        code,
      })) as { status?: string; createdSessionId?: string }

      if (result?.status === 'complete' && result.createdSessionId && clerkClient?.setActive) {
        await clerkClient.setActive({ session: result.createdSessionId })
      }
    }, CLERK_TEST_CODE)

    // Ask the Clerk client directly whether a user is attached. The helper
    // resolving is not the same as a session existing.
    const signedIn = await page.evaluate(
      () => Boolean((window as { Clerk?: { user?: unknown } }).Clerk?.user),
    )
    if (!signedIn) {
      const status = await page.evaluate(
        () =>
          (window as { Clerk?: { client?: { signIn?: { status?: string; firstFactorVerification?: unknown } } } })
            .Clerk?.client?.signIn?.status ?? 'unknown',
      )
      throw new Error(
        `\nclerk.signIn resolved but window.Clerk.user is empty for ${fixture.email}.\n` +
          `Clerk signIn status: ${status}\n` +
          'The credentials or the instance are wrong, or the testing token was\n' +
          'not accepted.\n',
      )
    }

    // Prove the session is real by landing on a page that requires one, rather
    // than trusting the helper's return value.
    await page.goto('/account')

    // Check the ORIGIN too. An unauthenticated /account bounces to Clerk's
    // hosted portal on accounts.dev, whose pathname is also /sign-in — a
    // pathname-only check waits for a navigation that never comes and reports a
    // timeout instead of "not signed in".
    const landed = new URL(page.url())
    if (landed.host !== new URL(baseURL ?? 'http://localhost:3000').host) {
      throw new Error(
        `\nSign-in did not take: /account redirected to ${landed.host}.\n` +
          'Clerk did not establish a session — check that CLERK_SECRET_KEY and\n' +
          'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY belong to the same development\n' +
          'instance as the fixture users.\n',
      )
    }

    await page.context().storageState({ path: storageStatePath(role) })
  })
}
