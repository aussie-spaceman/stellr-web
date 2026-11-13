import { expect, type Page } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import { sessionCookieProblem } from './session-cookie'

/**
 * Mint a new Clerk session token in `page`'s browser context and wait until the
 * context's cookies carry it, before the spec calls an API with `page.request`
 * or `context.request`. `page` must be on a page that loads Clerk (/account,
 * /admin). Call it right before the calls, and again before calls made much
 * later in the test.
 *
 * WHY (13 Nov 2026, owner decision 49): "load a page first" is not enough. A
 * Clerk session token lives 60 seconds. Every spec starts from the token saved
 * by auth.setup, and a navigation replaces it (Clerk's handshake) only when it
 * has ALREADY expired. A spec that runs about a minute after auth.setup loads
 * its page while the saved token still has a few seconds left, so nothing
 * replaces it; it expires before the API call, and the server answers 401 (403
 * from routes that refuse both alike). Run later, the token is long expired, the
 * navigation mints a new one, and the retry passes. In the CI runs of 12–13 Nov,
 * pd-credentials, mentor-credentials, credentials, survey and the course
 * builder all failed this way in the first 90 seconds of the suite, and passed
 * on retry. A spec that calls an API before Clerk has loaded should use this.
 *
 * The signal waited on is the cookie the server will read, not time: every
 * session cookie must be good for MIN_SECONDS_LEFT and issued after
 * `__client_uat` (session-cookie.ts mirrors Clerk's server checks).
 */
const MIN_SECONDS_LEFT = 30

export async function freshClerkSession(page: Page): Promise<void> {
  await clerk.loaded({ page })
  const minted = await page.evaluate(async () => {
    type Session = { getToken: (options: { skipCache: boolean }) => Promise<string | null> }
    const session = (window as { Clerk?: { session?: Session | null } }).Clerk?.session
    return session ? session.getToken({ skipCache: true }) : null
  })
  expect(minted, 'No Clerk session in this browser context: the saved sign-in has ended or never loaded').toBeTruthy()

  // Clerk's client writes the new token to the cookie when it arrives, so this
  // normally passes on the first read.
  const origin = new URL(page.url()).origin
  await expect
    .poll(async () => sessionCookieProblem(await page.context().cookies(origin), Date.now() / 1000, MIN_SECONDS_LEFT), {
      message: 'the Clerk session cookie was not refreshed',
    })
    .toBe('')
}
