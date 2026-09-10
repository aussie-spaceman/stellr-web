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

export function attachConsoleGuard(page: Page): string[] {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (BENIGN.some((pattern) => pattern.test(text))) return
    errors.push(text)
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
