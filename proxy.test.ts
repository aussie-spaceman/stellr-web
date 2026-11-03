// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, type NextFetchEvent } from 'next/server'

// Sign-up is invite-only (Clerk Restricted mode, 3 Nov 2026): a guest on a
// member page is sent to /sign-in, never /sign-up, keeping ?next so they come
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

describe('proxy: guests on member pages go to sign-in', () => {
  it('redirects a guest on /community to /sign-in with ?next', async () => {
    const res = await hit('/community/mentoring/discover')
    expect(res.status).toBe(307)
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/sign-in')
    expect(to.searchParams.get('next')).toBe('/community/mentoring/discover')
  })

  it('keeps the query string in ?next and redirects /home too', async () => {
    const res = await hit('/home?tab=events')
    const to = new URL(res.headers.get('location')!)
    expect(to.pathname).toBe('/sign-in')
    expect(to.searchParams.get('next')).toBe('/home?tab=events')
  })

  it('never sends a guest to /sign-up', async () => {
    for (const path of ['/community', '/community/surveys', '/home']) {
      const res = await hit(path)
      expect(res.headers.get('location') ?? '').not.toContain('/sign-up')
    }
  })

  it('lets a signed-in member through', async () => {
    state.userId = 'user_1'
    const res = await hit('/community/mentoring/discover')
    expect(res.headers.get('location')).toBeNull()
  })
})
