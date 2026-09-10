import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * Every link in the admin sidebar goes somewhere.
 *
 * WHY (10 Sept 2026): the sidebar offered "Delegations", pointing at
 * `/admin/delegations`, for as long as it took someone to notice — the page had
 * been deleted and the nav entry left behind. Clicking it 404'd, and because
 * Next prefetches sidebar links on a production build, every admin page quietly
 * fired a failing request.
 *
 * Nothing caught it: no spec loaded an admin page, and in dev mode Next does
 * not prefetch, so it was invisible locally even once one did.
 *
 * This reads the hrefs out of the rendered nav rather than a fixture list, so a
 * link added tomorrow is covered without anyone remembering to add it here.
 */

test.use({ storageState: storageStatePath('admin') })

test('no admin sidebar link 404s', async ({ page }) => {
  await page.goto('/admin')

  const hrefs = [
    ...new Set(
      // Not scoped to <nav>: that element holds only the five section
      // headers, and the sub-items — where the dead link was — sit outside it.
      (await page.locator('a[href^="/admin"]').evaluateAll((links) =>
        links.map((l) => l.getAttribute('href')),
      )).filter((h): h is string => Boolean(h)),
    ),
  ]

  // If the nav ever renders empty this must fail loudly rather than pass by
  // checking nothing — the empty-set trap that makes a suite look green.
  expect(hrefs.length, 'the admin sidebar rendered no links').toBeGreaterThan(10)

  // Two different failures, kept apart on purpose.
  //
  // A 404 is a DEAD LINK — the defect this spec exists for, always a hard fail.
  //
  // A 500 is the page erroring. One is currently expected and its cause is not
  // in this repo, so it is listed rather than silently tolerated: the dev
  // Supabase project does not expose the `entitlements` schema over PostgREST
  // (`listTiers`/`listDiscounts` fail with "Invalid schema: entitlements"), so
  // /admin/members/access 500s in dev and works in production.
  //
  // Fix: Supabase dashboard -> dev project -> Settings -> API -> Exposed
  // schemas -> add `entitlements`.
  //
  // The list is self-cleaning: an entry that starts PASSING also fails this
  // spec, so a stale exemption cannot sit here quietly granting cover to a
  // regression that arrives later.
  const KNOWN_SERVER_ERRORS = new Map([
    ['/admin/members/access', 'dev Supabase does not expose the `entitlements` schema'],
  ])

  const deadLinks: string[] = []
  const unexpectedErrors: string[] = []
  const fixedButStillListed: string[] = []

  for (const href of hrefs) {
    const status = (await page.request.get(href)).status()
    const known = KNOWN_SERVER_ERRORS.has(href)

    if (status === 404) deadLinks.push(href)
    else if (status >= 400 && !known) unexpectedErrors.push(`${href} -> ${status}`)
    else if (status < 400 && known) fixedButStillListed.push(href)
  }

  expect(deadLinks, 'admin sidebar links pointing at nothing').toEqual([])
  expect(unexpectedErrors, 'admin pages returning an unexpected error').toEqual([])
  expect(
    fixedButStillListed,
    'these now work — delete them from KNOWN_SERVER_ERRORS so the exemption cannot hide a future break',
  ).toEqual([])
})
