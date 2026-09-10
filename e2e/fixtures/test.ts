import { test as base } from '@playwright/test'
import { applyVercelBypass } from './vercel-bypass'

/**
 * The project's `test`, with Vercel's protection-bypass headers scoped to the
 * target origin. The scoping, and why it matters, is in `./vercel-bypass`.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await applyVercelBypass(page, baseURL)
    await use(page)
  },
})

export { expect } from '@playwright/test'
