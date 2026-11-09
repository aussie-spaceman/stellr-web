// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normaliseName } from '@/lib/check-in'
import { checkRateLimit, HOUR_MS, rateLimitGuard } from '@/lib/rate-limit'
import { TENANT_ID_HEADER, TENANT_ROUTING_FLAG, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'

// S5 A9: the participant routes on lib/rate-limit-async. These run the real limiter,
// so an un-awaited call or a dropped 429 fails here: only what each route does after
// the limiter is faked. In memory mode a route must answer as the sync guard did, on
// the same key, with no database call.

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  tenantHeaders: new Headers(),
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  }
  const client = { rpc: h.rpc, from: () => chain }
  return { supabaseServer: () => client }
})
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => h.tenantHeaders,
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/registration-checkout', () => ({}))
vi.mock('@/lib/individual-payment', () => ({}))
vi.mock('@/lib/scholarships', () => ({}))
vi.mock('@/lib/esign/native/flow', () => ({ resolveSession: async () => null, openLink: async () => null }))
vi.mock('@/lib/survey/access', () => ({ invitationByToken: async () => null }))
vi.mock('@/lib/survey/distributions', () => ({}))
vi.mock('@/lib/survey/send', () => ({}))
vi.mock('@/lib/team-profile/store', () => ({ sessionByToken: async () => null }))
vi.mock('@/lib/credentials', () => ({}))
vi.mock('@/lib/check-in-view', () => ({}))

const gateRefusal = async () => ({ ok: false, response: new Response('{}', { status: 422 }) })
vi.mock('@/lib/registration/individual/gate', () => ({ gateIndividualRegistration: gateRefusal }))
vi.mock('@/lib/registration/individual/persist', () => ({}))
vi.mock('@/lib/registration/individual/respond', () => ({}))
vi.mock('@/lib/registration/individual/stellr-hooks', () => ({}))
vi.mock('@/lib/registration/group/gate', () => ({ gateGroupRegistration: gateRefusal }))
vi.mock('@/lib/registration/group/persist', () => ({}))
vi.mock('@/lib/registration/group/respond', () => ({}))
vi.mock('@/lib/registration/group/stellr-hooks', () => ({}))
vi.mock('@/lib/registration/group-join/gate', () => ({ gateGroupJoinLink: gateRefusal }))
vi.mock('@/lib/registration/group-join/identify', () => ({}))
vi.mock('@/lib/registration/group-join/persist', () => ({}))
vi.mock('@/lib/registration/group-join/respond', () => ({}))
vi.mock('@/lib/registration/group-join/stellr-hooks', () => ({}))

type Handler = (req: never, ctx: never) => Promise<Response>
type Module = Record<string, Handler>

interface Case {
  name: string
  load: () => Promise<unknown>
  method: 'GET' | 'POST' | 'PATCH'
  route: string
  limit: number
  windowMs: number
  suffix?: string
  body?: unknown
  params?: Record<string, string>
}

const MINUTE = 60_000
const sign = (name: string, limit: number, load: () => Promise<unknown>, method: Case['method'] = 'POST'): Case => ({
  name: `sign/${name}`, load, method, route: `sign:${name}`, limit, windowMs: MINUTE,
})
const SURVEY_PARAMS = { token: 'a-token' }

const CASES: Case[] = [
  { name: 'register/individual', load: () => import('@/app/api/register/individual/route'), method: 'POST', route: 'register-individual', limit: 3, windowMs: HOUR_MS, suffix: 'colorado', body: { event_slug: 'colorado' } },
  { name: 'register/group', load: () => import('@/app/api/register/group/route'), method: 'POST', route: 'register-group', limit: 3, windowMs: HOUR_MS, suffix: 'colorado', body: { event_slug: 'colorado' } },
  { name: 'register/group-join', load: () => import('@/app/api/register/group-join/route'), method: 'POST', route: 'register-group-join', limit: 3, windowMs: HOUR_MS, suffix: 'a-link', body: { token: 'a-link' } },
  { name: 'register/pay', load: () => import('@/app/api/register/pay/route'), method: 'POST', route: 'register/pay', limit: 20, windowMs: 10 * MINUTE, body: {} },
  { name: 'register/pay-seat', load: () => import('@/app/api/register/pay-seat/route'), method: 'POST', route: 'register/pay-seat', limit: 20, windowMs: 10 * MINUTE, body: {} },
  { name: 'check-in', load: () => import('@/app/api/check-in/route'), method: 'POST', route: 'check-in', limit: 600, windowMs: HOUR_MS, suffix: 'colorado', body: { slug: 'colorado', token: 't', email: 'a@example.test' } },
  { name: 'team-profile', load: () => import('@/app/api/team-profile/[token]/route'), method: 'POST', route: 'team-profile', limit: 30, windowMs: MINUTE, params: SURVEY_PARAMS },
  { name: 'credentials/events', load: () => import('@/app/api/credentials/[number]/events/route'), method: 'POST', route: 'credential-events', limit: 30, windowMs: MINUTE, body: { kind: 'unknown' }, params: { number: 'C-1' } },
  { name: 'survey read', load: () => import('@/app/api/survey/[token]/route'), method: 'GET', route: 'survey', limit: 60, windowMs: MINUTE, params: SURVEY_PARAMS },
  { name: 'survey save', load: () => import('@/app/api/survey/[token]/route'), method: 'PATCH', route: 'survey', limit: 120, windowMs: MINUTE, body: {}, params: SURVEY_PARAMS },
  { name: 'survey/stop-reminders', load: () => import('@/app/api/survey/[token]/stop-reminders/route'), method: 'POST', route: 'survey-stop', limit: 30, windowMs: MINUTE, params: SURVEY_PARAMS },
  { name: 'survey/event/link', load: () => import('@/app/api/survey/event/[slug]/link/route'), method: 'POST', route: 'survey-link', limit: 5, windowMs: 10 * MINUTE, body: {}, params: { slug: 'colorado' } },
  sign('context', 60, () => import('@/app/api/sign/context/route'), 'GET'),
  sign('document', 20, () => import('@/app/api/sign/document/route'), 'GET'),
  sign('viewed', 20, () => import('@/app/api/sign/viewed/route')),
  sign('submit', 10, () => import('@/app/api/sign/submit/route')),
  sign('decline', 10, () => import('@/app/api/sign/decline/route')),
  sign('consent', 20, () => import('@/app/api/sign/consent/route')),
  sign('copy', 10, () => import('@/app/api/sign/copy/route')),
  sign('session', 20, () => import('@/app/api/sign/session/route')),
]

// The in-memory buckets outlive a test, so each test takes its own IP.
let n = 0
const freshIp = () => {
  n += 1
  return `203.0.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

function request(c: Pick<Case, 'method' | 'body'>, ip: string): Request {
  return new Request('https://www.example.test/api/route', {
    method: c.method,
    // A cross-site marker stops the signing POSTs at their origin check, after the limiter.
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'sec-fetch-site': 'cross-site' },
    ...(c.method === 'GET' ? {} : { body: JSON.stringify(c.body ?? {}) }),
  })
}

async function call(c: Case, ip: string, body = c.body): Promise<Response> {
  const handlers = (await c.load()) as Module
  const ctx = { params: Promise.resolve(c.params ?? {}) }
  return handlers[c.method](request({ method: c.method, body }, ip) as never, ctx as never)
}

/** Use up a window through the sync guard, on the key the route used before it moved. */
function exhaustSync(c: Case, ip: string): void {
  for (let i = 0; i < c.limit; i++) {
    expect(rateLimitGuard(request(c, ip), c.route, { limit: c.limit, windowMs: c.windowMs }, c.suffix)).toBeNull()
  }
}

const ANSWER_429 = JSON.stringify({ error: 'Too many requests — please wait a moment and try again.' })

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.rpc.mockReset()
  h.auth.mockReset()
  h.auth.mockResolvedValue({ userId: null })
  h.tenantHeaders = new Headers()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe.each(CASES)('$name', (c) => {
  it('answers the same limit with a real 429 and no database call, in memory mode', async () => {
    const ip = freshIp()
    for (let i = 0; i < c.limit; i++) {
      const res = await call(c, ip)
      expect(res).toBeInstanceOf(Response)
      expect(res.status).not.toBe(429)
    }

    const blocked = await call(c, ip)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('content-type')).toBe('application/json')
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(Number(blocked.headers.get('Retry-After'))).toBeLessThanOrEqual(c.windowMs / 1000)
    expect(await blocked.text()).toBe(ANSWER_429)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('keeps the key it had: a window the sync guard used up refuses it', async () => {
    const ip = freshIp()
    exhaustSync(c, ip)
    expect((await call(c, ip)).status).toBe(429)
    expect((await call(c, freshIp())).status).not.toBe(429)
  })

  it('takes the decision and Retry-After from the store in postgres mode', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'x'.repeat(32))
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: [{ allowed: false, retry_after: 33 }], error: null }) })

    const blocked = await call(c, freshIp())
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('33')
    expect(await blocked.text()).toBe(ANSWER_429)
    expect(h.rpc).toHaveBeenCalledWith('rate_limit_take', expect.objectContaining({
      p_limits: [c.limit],
      p_windows: [c.windowMs / 1000],
    }))
  })

  it('keeps the in-memory decision when the store cannot answer', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'x'.repeat(32))
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { message: 'down' } }) })

    const ip = freshIp()
    expect((await call(c, ip)).status).not.toBe(429)
    for (let i = 1; i < c.limit; i++) {
      rateLimitGuard(request(c, ip), c.route, { limit: c.limit, windowMs: c.windowMs }, c.suffix)
    }
    expect((await call(c, ip)).status).toBe(429)
  })

  it('counts another tenant separately once routing is on', async () => {
    const ip = freshIp()
    exhaustSync(c, ip)

    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    expect((await call(c, ip)).status).toBe(429)

    h.tenantHeaders = new Headers({
      [TENANT_ID_HEADER]: '11111111-1111-4111-8111-111111111111',
      [TENANT_SLUG_HEADER]: 'canary',
    })
    expect((await call(c, ip)).status).not.toBe(429)
  })
})

describe('the signed-in register counts', () => {
  const SIGNED_IN = CASES.filter((c) => c.name.startsWith('register/') && c.limit === 3)

  it.each(SIGNED_IN)('$name: a member has 3 of their own, under 30 for the event or link', async (c) => {
    h.auth.mockResolvedValue({ userId: 'user_1' })
    const ip = freshIp()

    // A household's anonymous allowance being spent does not touch the member's own.
    exhaustSync(c, ip)
    expect((await call(c, ip)).status).not.toBe(429)

    h.auth.mockResolvedValue({ userId: 'user_2' })
    const session = `${c.route}-session`
    for (let i = 0; i < 29; i++) {
      rateLimitGuard(request(c, ip), session, { limit: 30, windowMs: HOUR_MS }, c.suffix)
    }
    // user_1's call above made it 30, so the wider cap refuses a further account.
    expect((await call(c, ip)).status).toBe(429)
  })

  it.each(SIGNED_IN)('$name: the wider cap counts another tenant separately once routing is on', async (c) => {
    h.auth.mockResolvedValue({ userId: 'user_3' })
    const ip = freshIp()
    const session = `${c.route}-session`
    for (let i = 0; i < 30; i++) {
      rateLimitGuard(request(c, ip), session, { limit: 30, windowMs: HOUR_MS }, c.suffix)
    }
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    expect((await call(c, ip)).status).toBe(429)

    h.tenantHeaders = new Headers({
      [TENANT_ID_HEADER]: '11111111-1111-4111-8111-111111111111',
      [TENANT_SLUG_HEADER]: 'canary',
    })
    expect((await call(c, ip)).status).not.toBe(429)
  })
})

describe('check-in by name', () => {
  const c = CASES.find((x) => x.name === 'check-in') as Case
  const named = (first: string) => ({ slug: 'colorado', token: 't', firstName: first, lastName: 'Rivera', dob: '2011-04-09' })

  it('stops at 10 tries at one name with its own answer, from any IP', async () => {
    for (let i = 0; i < 10; i++) expect((await call(c, freshIp(), named('Sam'))).status).not.toBe(429)

    const blocked = await call(c, freshIp(), named('Sam'))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many tries. Please see the registration desk.' })
    expect(blocked.headers.get('Retry-After')).toBeNull()
    expect((await call(c, freshIp(), named('Jo'))).status).not.toBe(429)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('keeps the key it had: tries the sync guard counted refuse it', async () => {
    const key = `check-in-name:colorado:${normaliseName('Riley')}:${normaliseName('Rivera')}`
    for (let i = 0; i < 10; i++) expect(checkRateLimit(key, { limit: 10, windowMs: HOUR_MS }).ok).toBe(true)
    expect((await call(c, freshIp(), named('Riley'))).status).toBe(429)
  })

  it('counts each event apart: tries at one slug leave another alone', async () => {
    const at = (slug: string) => ({ ...named('Casey'), slug })
    for (let i = 0; i < 10; i++) await call(c, freshIp(), at('colorado'))
    expect((await call(c, freshIp(), at('colorado'))).status).toBe(429)
    expect((await call(c, freshIp(), at('nevada'))).status).not.toBe(429)
  })

  it('counts another tenant separately once routing is on', async () => {
    for (let i = 0; i < 10; i++) await call(c, freshIp(), named('Morgan'))
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    expect((await call(c, freshIp(), named('Morgan'))).status).toBe(429)

    h.tenantHeaders = new Headers({
      [TENANT_ID_HEADER]: '11111111-1111-4111-8111-111111111111',
      [TENANT_SLUG_HEADER]: 'canary',
    })
    expect((await call(c, freshIp(), named('Morgan'))).status).not.toBe(429)
  })

  it('reaches the store however many other names and slugs the IP has sent', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'x'.repeat(32))
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: [{ allowed: true, retry_after: 0 }], error: null }) })
    const ip = freshIp()
    for (let i = 0; i < 2_000; i++) {
      await call(c, ip, { ...named(`Spray${i}`), slug: `spray-${i}` })
    }

    // The slug's own budget is spent by now, so the one store call left is the name's.
    h.rpc.mockClear()
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: [{ allowed: false, retry_after: 60 }], error: null }) })
    const blocked = await call(c, ip, named('Quinn'))
    expect(h.rpc).toHaveBeenCalledOnce()
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: 'Too many tries. Please see the registration desk.' })
  })

  it('sends only hashes to the store, never the name or the IP', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'x'.repeat(32))
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: [{ allowed: true, retry_after: 0 }], error: null }) })

    await call(c, '203.0.113.200', named('Avery'))

    expect(h.rpc).toHaveBeenCalledTimes(2)
    const sent = JSON.stringify(h.rpc.mock.calls)
    expect(sent).not.toMatch(/avery|rivera|colorado|203\.0\.113\.200/i)
    for (const [, params] of h.rpc.mock.calls) expect(params.p_keys[0]).toMatch(/^\\x[0-9a-f]{64}$/)
  })
})

describe('which files still use the sync limiter', () => {
  const ROOT = process.cwd()
  const LANE_A = [
    'app/api/register', 'app/api/members/teams', 'app/api/check-in', 'app/api/check-in-desk', 'app/api/sign', 'app/api/survey',
    'app/api/credentials', 'app/api/team-profile', 'app/api/volunteer', 'app/api/consent', 'app/api/uploads',
    'app/api/stripe', 'app/api/webhooks', 'lib/registration', 'lib/esign', 'lib/survey', 'lib/team-profile',
  ]
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(rel)
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : []
    })
  const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

  it('is one in Lane A: the audit row cap, which limits a write and not the route', () => {
    const files = LANE_A.flatMap(walk).filter((f) => /\b(rateLimitGuard|checkRateLimit)\b/.test(read(f)))
    expect(files).toEqual(['app/api/uploads/sign/audit-coalescing.ts'])
  })

  it('every signing route awaits the throttle', () => {
    const routes = walk('app/api/sign').filter((f) => f.endsWith('route.ts'))
    expect(routes).toHaveLength(8)
    for (const file of routes) {
      const src = read(file)
      expect(src, file).toMatch(/await throttle\(/)
      expect(src.match(/\bthrottle\(/g)?.length, file).toBe(src.match(/await throttle\(/g)?.length)
    }
  })
})
