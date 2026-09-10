import type { Page } from '@playwright/test'

/**
 * Collect console errors and uncaught page errors, minus known-benign noise.
 *
 * Centralised rather than hand-rolled per spec: an allowlist that lives in one
 * place can be reviewed, while per-spec `page.on('console')` filters quietly
 * accumulate until a real regression is being ignored somewhere.
 *
 * The bar is console **errors**. Warnings never count — React's dev-mode
 * warnings alone would make the check useless.
 */

/**
 * Each entry needs a reason. If you cannot write one, it is probably a real
 * error rather than noise.
 */
const BENIGN = [
  // Clerk's dev instance warns loudly that it is a development build. Expected:
  // the dev environment is the only place this suite runs.
  /Clerk: Clerk has been loaded with development keys/i,

  // Chrome logs this for any request blocked by an ad blocker or by the
  // browser's own tracking protection. Nothing to do with the app.
  /net::ERR_BLOCKED_BY_CLIENT/,

  // Next dev-mode HMR chatter on a slow reconnect. Only ever seen locally.
  /\[Fast Refresh\]/,
]

/**
 * Origins that are not this app and whose failures say nothing about it.
 *
 * Filtering by ORIGIN rather than by message text matters. Vercel's preview
 * toolbar loads fonts from instant-preview-site.vercel.app, which fails CORS on
 * every preview page and produces two console errors per font: a descriptive
 * CORS line, and a bare "Failed to load resource: net::ERR_FAILED". Allowing
 * that second message by text would hide every genuine failed request in the
 * app — exactly the regressions this guard exists to catch. The console
 * message's location carries the resource URL, so the origin can be checked
 * instead.
 */
const THIRD_PARTY_ORIGINS = [
  'instant-preview-site.vercel.app', // Vercel preview toolbar assets
  'vercel.live', // Vercel comments/feedback widget
]

/**
 * Same-origin paths that only exist on Vercel's edge.
 *
 * `@vercel/analytics` injects a script from /_vercel/insights/, which Vercel's
 * infrastructure serves — not the Next server. Running the production build
 * anywhere else (CI, or `next start` locally) it 404s, always, and says nothing
 * about the app.
 *
 * A path exemption rather than ignoring 404s in general: a blanket 404 filter
 * would hide a genuinely missing image or script, which is exactly the kind of
 * regression this guard is for.
 */
const VERCEL_EDGE_PATHS = ['/_vercel/insights/', '/_vercel/speed-insights/']

function isThirdParty(url: string | undefined): boolean {
  if (!url) return false
  if (THIRD_PARTY_ORIGINS.some((origin) => url.includes(origin))) return true
  return VERCEL_EDGE_PATHS.some((path) => url.includes(path))
}

export function attachConsoleGuard(page: Page): string[] {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (BENIGN.some((pattern) => pattern.test(text))) return
    // The CORS message names the blocked URL in its text; the paired
    // ERR_FAILED names it only in the message location.
    if (isThirdParty(text) || isThirdParty(message.location()?.url)) return

    // Report WHERE, not just what. Chrome's "Failed to load resource: the
    // server responded with a status of 400" carries no URL in its text, so a
    // failure named only by that string cannot be acted on — you cannot tell an
    // app route from a third-party asset without re-running to reproduce.
    const url = message.location()?.url
    errors.push(url ? `${text} [${url}]` : text)
  })

  // An uncaught exception never reaches page.on('console') but is strictly
  // worse than one that does.
  page.on('pageerror', (error) => {
    const text = error.message
    if (BENIGN.some((pattern) => pattern.test(text))) return
    errors.push(`uncaught: ${text}`)
  })

  return errors
}
