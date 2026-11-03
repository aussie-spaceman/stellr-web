// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, type NextFetchEvent } from 'next/server'

// Anyone can create an account (decision 24, 3 Nov 2026). A guest on a member
// page is sent to sign-in, whose card links on to sign-up; a guest on a page
// meant for new members goes straight to sign-up. Both keep ?next so they come
// back to the page they asked for. Clerk is stubbed: clerkMiddleware just runs
// the handler with an auth() that reports the test's userId.

const state = vi.hoisted(() => ({ userId: null as string | null }))

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) =>
    new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware: (
      handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>,
    ) => (req: NextRequest, event: NextFetchEvent) => {
      const auth = Object.assign(async () => ({ userId: state.userId, sessionClaims: null }), { protect: async () => {} })
      return handler(auth, req, event)
    },
  }
})
vi.mock('@/lib/env', () => ({ APP_HOST: 'localhost:3000', SITE_URL: 'http://localhost:3000' }))
vi.mock('@/lib/crawlers', () => ({ matchCrawler: () => null, recordCrawlerHit: async () => {} }))

import proxy from './proxy'

const event = { waitUntil: () => {} } as unknown as NextFetchEvent
const hit = (path: string) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000' } }), event)

beforeEach(() => {
  state.userId = null
})

describe('proxy: guests on member pages get sign-in or sign-up', () => {
  it('redirects a guest on /community to /sign-in with ?next', async () => {
    const res = await hit('/community')
    expect(res.status).toBe(307)
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/sign-in')
    expect(to.searchParams.get('next')).toBe('/community')
  })

  it('keeps the query string in ?next and redirects /home too', async () => {
    const res = await hit('/home?tab=events')
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/sign-in')
    expect(to.searchParams.get('next')).toBe('/home?tab=events')
  })

  it('sends a guest on mentoring discovery, a page for new members, to /sign-up with ?next', async () => {
    const res = await hit('/community/mentoring/discover')
    expect(res.status).toBe(307)
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/sign-up')
    expect(to.searchParams.get('next')).toBe('/community/mentoring/discover')
  })

  it('sends a guest on other mentoring pages to /sign-in', async () => {
    for (const path of ['/community/mentoring', '/community/mentoring/abc', '/community/surveys']) {
      const to = new URL((await hit(path)).headers.get('location')!)
      expect(to.pathname).toBe('/sign-in')
      expect(to.searchParams.get('next')).toBe(path)
    }
  })

  it('lets a signed-in member through', async () => {
    state.userId = 'user_1'
    const res = await hit('/community/mentoring/discover')
    expect(res.headers.get('location')).toBeNull()
  })
})
