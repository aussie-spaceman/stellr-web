// @vitest-environment node
import { NextRequest, type NextFetchEvent } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The proxy's admin role gate for an Event Manager, who may enter only the
// Competitions section of the admin portal (proxy.ts isAdminEventsRoute). Clerk
// is stubbed as in proxy.test.ts, with the session's role claim set per test.
//
// staff-role.P3.em-campaign-redirect is still open: a campaign's competition
// page links to /admin/campaigns/<slug>, which this gate sends back to
// Competitions. The fix adds that path to isAdminEventsRoute, and also needs
// test/authz-pilot-c13.test.ts's pinned list of those paths updated, so it is
// left to a change that owns that file. When it lands, move
// '/admin/campaigns/sample-campaign' from the second list below to the first.

const state = vi.hoisted(() => ({ userId: 'user_placeholder' as string | null, role: 'event_manager' as string | null }))

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) => new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware:
      (handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>) =>
      (req: NextRequest, event: NextFetchEvent) => {
        const session = { userId: state.userId, sessionClaims: state.role ? { metadata: { role: state.role } } : null }
        const auth = Object.assign(async () => session, { protect: async () => {} })
        return handler(auth, req, event)
      },
  }
})
vi.mock('@/lib/env', () => ({ APP_HOST: 'localhost:3000', SITE_URL: 'http://localhost:3000' }))
vi.mock('@/lib/crawlers', () => ({ matchCrawler: () => null, recordCrawlerHit: async () => {} }))

import proxy from '@/proxy'

const event = { waitUntil: () => {} } as unknown as NextFetchEvent
const hit = (path: string) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000' } }), event)
const redirectedTo = async (path: string) => {
  const location = (await hit(path)).headers.get('location')
  return location ? new URL(location).pathname : null
}

beforeEach(() => {
  state.userId = 'user_placeholder'
  state.role = 'event_manager'
})

describe('proxy: an Event Manager in the admin portal', () => {
  it.each([
    '/admin/competitions',
    '/admin/competitions/sample-event',
    '/admin/competitions/sample-event/check-in',
    '/admin/events/sample-event',
  ])('reaches %s', async (path) => {
    expect(await redirectedTo(path)).toBeNull()
  })

  it.each([
    '/admin',
    '/admin/campaigns',
    '/admin/campaigns/sample-campaign',
    '/admin/schools',
    '/admin/members',
    '/admin/view-as',
    '/admin/academy/training',
  ])('is sent from %s to Competitions', async (path) => {
    expect(await redirectedTo(path)).toBe('/admin/competitions')
  })
})

describe('proxy: an admin page for the other roles', () => {
  it('lets an admin and a staff member through', async () => {
    for (const role of ['admin', 'staff']) {
      state.role = role
      expect(await redirectedTo('/admin/campaigns/sample-campaign'), role).toBeNull()
    }
  })

  it('sends a signed-in member with no portal role to /account', async () => {
    for (const role of [null, 'member']) {
      state.role = role
      expect(await redirectedTo('/admin/competitions'), String(role)).toBe('/account')
      expect(await redirectedTo('/admin/campaigns/sample-campaign'), String(role)).toBe('/account')
    }
  })
})
