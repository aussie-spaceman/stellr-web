import { test as base } from '@playwright/test'

/**
 * The project's `test`, with Vercel's protection-bypass headers scoped to the
 * target origin.
 *
 * Setting these through `use.extraHTTPHeaders` sends them to EVERY origin,
 * including fonts.gstatic.com and clerk.accounts.dev. Both reject the unexpected
 * header in CORS preflight, so fonts and the Clerk SDK fail to load and every
 * page logs console errors — which looks exactly like an app regression and is
 * not one. Observed on 10 Sept, on a run that was otherwise correct.
 *
 * So the headers go on only for requests to the host under test. Third-party
 * requests go out untouched, as a real browser would send them.
 */
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (BYPASS && baseURL) {
      const targetHost = new URL(baseURL).host

      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.host !== targetHost) {
          await route.continue()
          return
        }
        await route.continue({
          headers: {
            ...route.request().headers(),
            'x-vercel-protection-bypass': BYPASS,
            'x-vercel-set-bypass-cookie': 'true',
          },
        })
      })
    }

    await use(page)
  },
})

export { expect } from '@playwright/test'
