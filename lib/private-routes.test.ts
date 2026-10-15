import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isPrivatePath } from '@/lib/private-routes'

describe('isPrivatePath', () => {
  it('treats the scholarship offer bearer link as private (PUB-13)', () => {
    // The offer link's token is the only key — it reveals a (usually minor)
    // applicant's first name and event and mints a working pay link. It must
    // not hand that URL to GA4 / HubSpot / Vercel Analytics, like /credentials.
    expect(isPrivatePath('/scholarship/offer/abcdef123456')).toBe(true)
    // The public scholarship landing page itself stays public and tracked.
    expect(isPrivatePath('/scholarship')).toBe(false)
    expect(isPrivatePath('/scholarship/apply')).toBe(false)
  })

  it('treats credential pages as private so no tracking loads (MP-1)', () => {
    // The guardian "view credential" email carries a ?k= bearer token for a
    // private minor credential; these pages must not hand it (or the child's
    // name) to GA4 / HubSpot / Vercel Analytics.
    expect(isPrivatePath('/credentials/STL-2026-ABCD1234')).toBe(true)
    expect(isPrivatePath('/credentials')).toBe(true)
  })

  it('keeps the existing private link routes private', () => {
    expect(isPrivatePath('/sign')).toBe(true)
    expect(isPrivatePath('/sign/copy')).toBe(true)
    expect(isPrivatePath('/register/nevada-2027/join/abc')).toBe(true)
    expect(isPrivatePath('/register/nevada-2027/pay/abc')).toBe(true)
    expect(isPrivatePath('/survey/tok')).toBe(true)
    expect(isPrivatePath('/team-profile/tok')).toBe(true)
    expect(isPrivatePath('/privacy/request')).toBe(true)
  })

  it('treats event check-in as private: the QR link carries the check-in token and minors enter a date of birth', () => {
    expect(isPrivatePath('/check-in')).toBe(true)
    expect(isPrivatePath('/check-in/nevada-space-design-challenge')).toBe(true)
    expect(isPrivatePath('/check-inside')).toBe(false)
  })

  it('leaves ordinary public pages public', () => {
    expect(isPrivatePath('/about')).toBe(false)
    expect(isPrivatePath('/events')).toBe(false)
    expect(isPrivatePath('/register/nevada-2027/individual')).toBe(false)
    // not a credential path, just a prefix collision
    expect(isPrivatePath('/credentialsomething')).toBe(false)
  })
})

// PUB-13: a page whose `[token]` is its only key is a bearer link — the token
// names a person and leads to a working action. Every such page under
// app/(public) must be registered as private so the root layout loads no
// analytics on it and the token URL never reaches a third party. This guard
// fails if a new `[token]` page is added without adding it here (and the
// matching next.config.mjs privateLink header). Single-task pages live in
// app/(flow), which shares the public URL space, so both groups are walked.
describe('every public [token] bearer-link page is private (PUB-13)', () => {
  const PUBLIC_DIRS = [join(process.cwd(), 'app', '(public)'), join(process.cwd(), 'app', '(flow)')]

  // Walk app/(public) for page.tsx files whose route contains a `[token]`
  // segment, returning a concrete sample path for each (placeholders for the
  // dynamic segments). Route groups `(…)` don't appear in the URL.
  function tokenRoutes(dir: string, prefix = ''): string[] {
    const routes: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === 'page.tsx') {
        if (prefix.includes('/sampletoken')) routes.push(prefix)
        continue
      }
      if (!entry.isDirectory()) continue
      const name = entry.name
      const segment = name.startsWith('(')
        ? ''
        : name === '[token]'
          ? '/sampletoken'
          : name.startsWith('[')
            ? '/sample-slug'
            : `/${name}`
      routes.push(...tokenRoutes(join(dir, name), prefix + segment))
    }
    return routes
  }

  const routes = PUBLIC_DIRS.flatMap((dir) => tokenRoutes(dir))

  it('finds the known bearer-link pages on disk (walker sanity check)', () => {
    expect(routes).toContain('/scholarship/offer/sampletoken')
    expect(routes).toContain('/survey/sampletoken')
    expect(routes.length).toBeGreaterThanOrEqual(3)
  })

  it('matches every [token] page as private', () => {
    const leaked = routes.filter((r) => !isPrivatePath(r))
    expect(
      leaked,
      `These [token] bearer-link pages are not private — add them to lib/private-routes.ts and next.config.mjs: ${leaked.join(', ')}`,
    ).toEqual([])
  })
})
