// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// deep review AUTH-1 / AUTH-N1: the page-side twin of test/route-guards.test.ts.
//
// proxy.ts (C-2) gates /admin in middleware, but Next skips layouts on RSC
// navigation requests, so the (admin) layout is NOT a reliable barrier and the
// data pages fetch minors' PII. The C-2 fix left middleware as the SOLE gate and
// added nothing on the page side and no test. This sweep asserts every admin page
// outside competitions/campaigns calls a page-level guard (requireAdminPage, or
// the pre-existing isAdminClaims / inline role check), so a new admin page cannot
// ship relying only on the middleware matcher — the regression class AUTH-1 was.
//
// competitions/ and campaigns/ pages are excluded: they use requireEventAccess
// (which admits an assigned event manager) rather than the admin-only guard.

const BASE = 'app/(admin)/admin'

// readdirSync(dir, { recursive: true }) returns paths relative to `dir`.
// (fs.globSync is Node 22+ but isn't in this repo's @types/node yet; CI/Vercel
// run Node 24, matching test/route-guards.test.ts.)
function adminPages(): string[] {
  return (readdirSync(BASE, { recursive: true }) as string[])
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.endsWith('/page.tsx') || p === 'page.tsx')
    .filter((p) => !p.startsWith('competitions/') && !p.startsWith('campaigns/'))
}

// A page-level authorisation call. requireAdminPage is the uniform guard added
// by AUTH-N1; isAdminClaims and the inline role check are the pre-existing
// top-of-loader guards on media/surveys/scholarships/docusigns/privacy-requests.
const PAGE_GUARD = /requireAdminPage\(|isAdminClaims\(|role\s*(!==|===)\s*['"]admin['"]/

describe('admin page guards (static inventory)', () => {
  it('every admin page outside competitions/campaigns guards its loader', () => {
    const pages = adminPages()
    // Sanity: the sweep must actually find the pages, or the test is vacuously green.
    expect(pages.length).toBeGreaterThan(30)
    const missing = pages.filter((p) => !PAGE_GUARD.test(readFileSync(`${BASE}/${p}`, 'utf8')))
    expect(missing).toEqual([])
  })
})
