import type { Page, Response } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { recordCreatedSession } from './session-ledger'
import { FIXTURES, type FixtureRole } from './users'

// Signs a fixture user in on `page`, making a NEW Clerk session, and proves it
// by landing on /account. Shared by e2e/auth.setup.ts (which saves the session
// for every spec) and by any test that must end a session: signing out of the
// saved one would sign out every other test using it.
//
// Against a protected deployment, apply the Vercel bypass before calling this
// (e2e/fixtures/test.ts does it for specs; auth.setup does it itself).
//
// Signs in by email: Clerk's helper uses CLERK_SECRET_KEY, server side, to mint
// a one-use ticket that expires in 5 minutes, and the browser only sees that.
// No password goes through the page. A password would be passed to
// page.evaluate, and a Playwright trace records evaluate arguments, so a retried
// sign-in would publish it in the report on this public repo. A ticket also
// skips Clerk's new-device code, which the password route had to answer.

export async function signInAs(page: Page, role: FixtureRole, baseURL: string | undefined): Promise<void> {
  const fixture = FIXTURES[role]

  // Must precede the first navigation: it installs the token the Clerk client
  // picks up on load.
  await setupClerkTestingToken({ page })

  // The app's own pages, not /sign-in: clerk.signIn drives the Clerk client
  // directly and the sign-in route's own component competes with it.
  //
  // The public pages load Clerk only for a browser that looks signed in (the
  // `__client_uat` hint, lib/session-hint.ts), so set the hint first, as a
  // returning member's browser would have it. Clerk corrects it to 0 on load.
  await page.context().addCookies([
    { name: '__client_uat', value: '1', url: baseURL ?? 'http://localhost:3000' },
  ])
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

  // Record the session from Clerk's response, the moment it exists. A sign-in
  // that fails after this point still leaves a live session, and a failed run is
  // the one whose report gets uploaded, so waiting until sign-in has succeeded
  // would miss exactly the sessions that matter.
  const recording: Promise<void>[] = []
  const onResponse = (response: Response) => {
    if (!new URL(response.url()).pathname.startsWith('/v1/client/sign_ins')) return
    recording.push(
      response
        .json()
        .then((body: { response?: { created_session_id?: string | null } }) => {
          const sessionId = body.response?.created_session_id
          if (sessionId) recordCreatedSession(sessionId)
        })
        .catch(() => {}),
    )
  }
  page.on('response', onResponse)
  try {
    await clerk.signIn({ page, emailAddress: fixture.email })
  } finally {
    page.off('response', onResponse)
    await Promise.all(recording)
  }

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
