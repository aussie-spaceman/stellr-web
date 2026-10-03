import type { Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { FIXTURES, type FixtureRole } from './users'

// Signs a fixture user in on `page`, making a NEW Clerk session, and proves it
// by landing on /account. Shared by e2e/auth.setup.ts (which saves the session
// for every spec) and by any test that must end a session: signing out of the
// saved one would sign out every other test using it.
//
// Against a protected deployment, apply the Vercel bypass before calling this
// (e2e/fixtures/test.ts does it for specs; auth.setup does it itself).

/**
 * Clerk's fixed code for `+clerk_test` addresses on a development instance. Not
 * a secret: identical across every Clerk dev instance, and only accepted for
 * test users — which is what makes an inbox-free sign-in possible.
 */
const CLERK_TEST_CODE = '424242'

export async function signInAs(page: Page, role: FixtureRole, baseURL: string | undefined): Promise<void> {
  const fixture = FIXTURES[role]
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

  // Wait for the Clerk client explicitly before signing in.
  //
  // clerk.signIn() waits internally via page.waitForFunction, which inherits
  // the config's 15s actionTimeout — enough locally, not enough on a cold CI
  // runner fetching Clerk's script from accounts.dev. All three fixtures
  // failed that way on the first real CI run while every smoke test passed.
  //
  // A longer wait on the RIGHT condition, rather than a longer blanket
  // actionTimeout: this waits for Clerk to be ready and still fails fast if
  // it never is, instead of slowing every action in the suite.
  await clerk.loaded({ page })

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

}
