// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SiteTracking } from './SiteTracking'

// The real trackers, with no window, as the prerender runs them. SiteTracking.test.tsx
// mocks them, so this is what holds its hydration test to the markup they really send.
// The ids are set before the trackers load, so they don't sit dormant here.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_GTM_ID = 'GTM-TEST'
  process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID = '1'
})
let pathname = '/about'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

describe('what the server sends', () => {
  it('is the banner and no tracker tag on a public page', () => {
    pathname = '/about'
    const html = renderToString(<SiteTracking />)
    expect(html).toContain('data-cookie-banner')
    expect(html).not.toMatch(/<(script|noscript|iframe|link)\b/)
    expect(html).not.toMatch(/googletagmanager|hs-scripts|_vercel\/|va\.vercel-scripts/)
  })

  it('is nothing on a private link', () => {
    pathname = '/sign/abc'
    expect(renderToString(<SiteTracking />)).toBe('')
  })
})
