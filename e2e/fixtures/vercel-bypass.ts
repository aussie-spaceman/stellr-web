import type { Page } from '@playwright/test'

/**
 * Vercel's protection-bypass headers, scoped to the target origin.
 *
 * Setting these through `use.extraHTTPHeaders` sends them to EVERY origin,
 * including fonts.gstatic.com and clerk.accounts.dev. Both reject the
 * unexpected header in CORS preflight, so fonts and the Clerk SDK fail to load
 * and every page logs console errors — which looks exactly like an app
 * regression and is not one (observed 10 Sept, on an otherwise correct run).
 * It would also hand a working credential to third parties.
 *
 * So the headers go on only for requests to the host under test. Third-party
 * requests go out untouched, as a real browser would send them.
 *
 * Lives here rather than in the `test` fixture because `auth.setup.ts` needs it
 * too and cannot use that fixture — it builds sessions with Playwright's own
 * `test` object. Without it the setup drives Vercel's SSO login page instead of
 * the app, Clerk never initialises, and the only symptom is `clerk.loaded()`
 * timing out with nothing to say why.
 */
export async function applyVercelBypass(page: Page, baseURL: string | undefined) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (!bypass || !baseURL) return

  const targetHost = new URL(baseURL).host

  // Nothing to bypass on a local server, and the interceptor is not free:
  // routing every request through it slowed the cold dev server enough that
  // `clerk.loaded()` missed its 15s wait whenever the 22 smoke specs were
  // running alongside the auth setup. Installing it only where it does
  // something keeps local runs at their previous speed.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(targetHost)) return

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.host !== targetHost) {
      await route.continue()
      return
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-vercel-protection-bypass': bypass,
        // Safe here, unlike in a plain `fetch`: Vercel answers 307 -> '/' so it
        // can set _vercel_jwt, and a browser context keeps the cookie. See the
        // note in e2e/global-setup.ts, where not keeping it caused a loop.
        'x-vercel-set-bypass-cookie': 'true',
      },
    })
  })
}
