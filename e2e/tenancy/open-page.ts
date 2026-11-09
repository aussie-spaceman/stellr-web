import type { Page } from '@playwright/test'
import { rawGet } from '../fixtures/tenant-hosts'

export type Violation = { directive: string; blocked: string; disposition: string }

declare global {
  interface Window {
    __csp: Violation[]
    __ran?: boolean
  }
}

/**
 * Opens a page under the headers the server really sends. The document comes through
 * rawGet because a browser's page load draws Clerk's handshake redirect, and the harness
 * has no Clerk instance to send it to. Headers and body are the server's, untouched,
 * unless `inject` adds markup to the body, as a flaw in a page would, or `rewrite` changes
 * it, as a page that no longer matches its own data would.
 */
export async function open(page: Page, port: number, host: string, path: string, inject = '', rewrite: (html: string) => string = (html) => html) {
  await page.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, disposition: e.disposition })
    })
  })
  await page.route(`http://${host}:${port}${path}`, async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue()
    const res = await rawGet(port, host, path)
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(res.headers)) {
      if (value !== undefined && !['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'content-encoding'].includes(name)) {
        headers[name] = Array.isArray(value) ? value.join(', ') : value
      }
    }
    await route.fulfill({ status: res.status, headers, body: rewrite(res.body).replace('</body>', `${inject}</body>`) })
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://${host}:${port}${path}`, { waitUntil: 'load' })
  return { errors }
}

/** True once React has hydrated the page, which takes Next's scripts running. */
export const hydrated = (page: Page) =>
  page.waitForFunction(
    () => {
      const el = document.querySelector('main') ?? document.body
      return Object.keys(el).some((key) => key.startsWith('__reactFiber'))
    },
    undefined,
    { timeout: 30_000 },
  )

export const violations = (page: Page) => page.evaluate(() => window.__csp)
