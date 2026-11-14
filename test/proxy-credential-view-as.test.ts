// @vitest-environment node
import { NextRequest, type NextFetchEvent } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation-cookie'

// credential-view-as.3. Production serves the public site on www and the member
// portal on app, and the proxy sends public-only pages from app to www. Admin
// view-as is a host-only cookie on app, so a credential page opened on www
// resolves the admin rather than the member. While the cookie is set, the proxy
// keeps /credentials/<number> on app (the page re-checks the cookie and the
// admin claim). Dev and e2e run on one host, where this branch never runs, so
// this test gives the proxy two hosts. Clerk is stubbed as in proxy.test.ts.

const APP = 'app.placeholder.test'
const WWW = 'www.placeholder.test'

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) => new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware:
      (handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>) =>
      (req: NextRequest, event: NextFetchEvent) => {
        const auth = Object.assign(async () => ({ userId: 'user_placeholder', sessionClaims: { metadata: { role: 'admin' } } }), {
          protect: async () => {},
        })
        return handler(auth, req, event)
      },
  }
})
vi.mock('@/lib/env', () => ({ APP_HOST: 'app.placeholder.test', SITE_URL: 'https://www.placeholder.test' }))
vi.mock('@/lib/crawlers', () => ({ matchCrawler: () => null, recordCrawlerHit: async () => {} }))

import proxy from '@/proxy'

const event = { waitUntil: () => {} } as unknown as NextFetchEvent
const VIEW_AS = `${IMPERSONATION_COOKIE}=placeholder`

function hit(host: string, path: string, cookie?: string) {
  const headers: Record<string, string> = { host }
  if (cookie) headers.cookie = cookie
  return proxy(new NextRequest(`https://${host}${path}`, { headers }), event)
}

beforeEach(() => {
  vi.stubEnv('TENANT_ROUTING_ENABLED', '')
})

describe('proxy: a credential page on the app host', () => {
  const CREDENTIAL = '/credentials/STL-0000-SAMPLE'

  it('goes to www without the view-as cookie, query kept', async () => {
    const res = await hit(APP, `${CREDENTIAL}?k=placeholder`)
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(`https://${WWW}${CREDENTIAL}?k=placeholder`)
  })

  it('stays on app with the view-as cookie', async () => {
    const res = await hit(APP, CREDENTIAL, VIEW_AS)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('stays on app with the cookie among others', async () => {
    const res = await hit(APP, `${CREDENTIAL}/badge`, `other=1; ${VIEW_AS}; more=2`)
    expect(res.headers.get('location')).toBeNull()
  })

  it('exempts only credential pages: other public-only pages still go to www', async () => {
    for (const path of ['/about', '/events/sample-event', '/register/sample-event/individual', '/credentials']) {
      const res = await hit(APP, path, VIEW_AS)
      expect(res.status, path).toBe(308)
      expect(res.headers.get('location'), path).toBe(`https://${WWW}${path}`)
    }
  })

  it('ignores a cookie of another name', async () => {
    const res = await hit(APP, CREDENTIAL, `${IMPERSONATION_COOKIE}x=placeholder`)
    expect(res.status).toBe(308)
  })
})

describe('proxy: a credential page on www', () => {
  it('is served there with or without the cookie', async () => {
    for (const cookie of [undefined, VIEW_AS]) {
      const res = await hit(WWW, '/credentials/STL-0000-SAMPLE', cookie)
      expect(res.headers.get('location'), String(cookie)).toBeNull()
      expect(res.headers.get('x-middleware-next')).toBe('1')
    }
  })

  // proxy-matcher-gated-prefixes.6: tracking is decided in the browser, and no
  // page read this header, so the proxy no longer sets it.
  it('forwards no private-route header to the page', async () => {
    const res = await hit(WWW, '/credentials/STL-0000-SAMPLE')
    expect(res.headers.get('x-middleware-request-x-stellr-private-route')).toBeNull()
  })
})
