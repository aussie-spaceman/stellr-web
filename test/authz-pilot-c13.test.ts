// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { sanitizeMetadata } from '@/lib/audit/platform'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { globToRegExp, routeOf, transformSource } from '../scripts/codemods/authz'
import { LEGACY_IDIOMS, measureIdioms } from '../scripts/authz-idioms.mjs'

// The C13 pilot (docs/TENANCY-S5.md): the Stellr-only community, academy, training, coaching,
// container, membership-rule and entitlement admin, on lib/authz and platform audit.
//
// Under AUTHZ_SOURCE=clerk every answer stays the same, and every refusal keeps its bytes. The
// refusal table below passes on the code from before the conversion too: that is the proof it
// pins an answer rather than a mock. With PLATFORM_AUDIT_ENABLED off, a handler reads no session
// for audit and writes nothing.

const AREAS = [
  'app/api/admin/community/**',
  'app/api/admin/training/**',
  'app/api/admin/coaching/**',
  'app/api/admin/containers/**',
  'app/api/admin/membership/**',
  'app/api/admin/entitlements/**',
  'app/(stellr)/(admin)/admin/academy/**',
  'app/(stellr)/(admin)/admin/community/**',
].map(globToRegExp)

const FILES = Object.keys(ROUTE_MANIFEST).filter((f) => AREAS.some((r) => r.test(f)))
const ROUTES = FILES.filter((f) => /\/route\.tsx?$/.test(f))
const PAGES = FILES.filter((f) => /\/page\.tsx$/.test(f))
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

// ── Mocks ────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ grantAdhoc: vi.fn(async () => 1) }))
const grantSpy = () => {
  h.grantAdhoc.mockClear()
  return h.grantAdhoc
}
const authMock = vi.fn()
const auditMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, id: 1, seq: 1 }))
/** The database stand-in. Throws by default, so a refusal is seen to reach no query. */
const dbCalls = vi.fn()
let db: unknown

vi.mock('@clerk/nextjs/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  auth: () => authMock(),
}))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => {
    dbCalls()
    return db
  },
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: (...args: unknown[]) => auditMock(...args),
}))
// The write would otherwise wait for a real request's after().
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    pending.push(task())
  },
}))
vi.mock('@/lib/community', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSignedInMember: async () => ({ id: MEMBER, isAdmin: true }),
}))
vi.mock('@/lib/notify', () => ({ notifyMember: vi.fn(async () => {}) }))
vi.mock('@/lib/entitlements', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteDiscount: vi.fn(async () => {}),
  upsertDiscount: vi.fn(async () => ({ id: ROW })),
  setTierAllocationQuantity: vi.fn(async () => {}),
  grantAdhocEntitlement: h.grantAdhoc,
}))
vi.mock('@/lib/container-sync', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureCoachingContainer: vi.fn(async () => ROW),
}))
vi.mock('@/lib/sessions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoachingChannel: vi.fn(async () => null),
}))
vi.mock('@/lib/resource-upload', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLinkBinary: vi.fn(async () => ({ binaryId: ROW })),
}))
vi.mock('@/lib/access-objects', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  attachAllowed: vi.fn(async () => true),
  resolveAccessObject: vi.fn(async () => null),
}))
vi.mock('@/lib/coaching', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWorkshop: vi.fn(async () => ROW),
}))
vi.mock('@/lib/uploads', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  claimUpload: vi.fn(async () => ({ bucket: 'b', bytes: new Uint8Array() })),
}))

const pending: Promise<unknown>[] = []
const MEMBER = '11111111-1111-4111-8111-111111111111'
const ROW = '22222222-2222-4222-8222-222222222222'
const INPUT = '33333333-3333-4333-8333-333333333333'
const PATH = '44444444-4444-4444-8444-444444444444'

const ADMIN = { userId: 'user_admin1', sessionClaims: { metadata: { role: 'admin' } } }
const REFUSED: [string, unknown][] = [
  ['signed out', { userId: null, sessionClaims: null }],
  ['a member with no role', { userId: 'user_member1', sessionClaims: { metadata: {} } }],
  ['an event manager', { userId: 'user_em1', sessionClaims: { metadata: { role: 'event_manager' } } }],
  ['a member role', { userId: 'user_crew1', sessionClaims: { metadata: { role: 'member' } } }],
]

/** Answers every query with one row, whatever is asked. */
function okDb() {
  const row = { id: ROW, name: 'A name', slug: 'a-slug', status: 'pending', member_id: MEMBER, author_member_id: MEMBER, content_type: 'post', content_id: ROW, viewed_in_container: null }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit', 'range', 'ilike']) chain[m] = () => chain
  chain.single = async () => ({ data: row, error: null })
  chain.maybeSingle = async () => ({ data: row, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [row], error: null, count: 0 })
  return { from: () => chain, storage: { from: () => ({ remove: async () => ({ error: null }) }) } }
}

const throwingDb = new Proxy({}, { get: () => { throw new Error('reached the database') } })

function request(url: string, method: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function loadRoute(file: string): Promise<Record<string, Handler>> {
  const mod = await import(/* @vite-ignore */ `../${file}`)
  return mod as Record<string, Handler>
}

const ctx = (id = ROW) => ({ params: Promise.resolve({ id }) })

async function settled() {
  await Promise.all(pending.splice(0))
}

beforeEach(() => {
  authMock.mockReset()
  auditMock.mockClear()
  dbCalls.mockClear()
  db = throwingDb
  vi.stubEnv('AUTHZ_SOURCE', 'clerk')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
})

afterEach(async () => {
  await settled()
  vi.unstubAllEnvs()
})

// ── The tree ─────────────────────────────────────────────────────────────────

describe('what the pilot covers', () => {
  const read = (f: string) => readFileSync(f, 'utf8')

  it('is the 29 routes and 16 pages it says it is, all stellr_only, with no class moved', () => {
    expect(ROUTES).toHaveLength(29)
    expect(PAGES).toHaveLength(16)
    for (const f of FILES) expect(ROUTE_MANIFEST[f], f).toBe('stellr_only')
  })

  it('no file holds a legacy idiom, by the ratchet\'s own measure', () => {
    expect(LEGACY_IDIOMS.length).toBeGreaterThan(0)
    expect(measureIdioms(new Map(FILES.map((f) => [f, read(f)])))).toEqual({})
  })

  it('the codemod has nothing left to do here, and nothing it left for a person', () => {
    for (const f of FILES) {
      const t = transformSource(f, read(f))
      expect(t.src, f).toBe(read(f))
      expect(t.manual, f).toEqual([])
    }
  })

  it('every guard names its own route', () => {
    for (const f of FILES) {
      const route = routeOf(f) as string
      const named = [...read(f).matchAll(/route: '([^']+)'/g)].map((m) => m[1])
      expect(named.length, f).toBeGreaterThan(0)
      for (const n of named) expect(n, f).toBe(route)
    }
  })

  it('every mutating handler audits on every path, under the gate', () => {
    const mutating = ROUTES.flatMap((f) => auditHandlers(f, read(f)))
    expect(mutating).toHaveLength(42)
    for (const h of mutating) expect(h, h.key).toMatchObject({ audited: true, coverage: 'mandatory' })
  })

  it('every action a pilot route names is in the catalogue, once', () => {
    const named = ROUTES.flatMap((f) => [...read(f).matchAll(/^ {4}action: '([a-z_.]+)',$/gm)].map((m) => m[1]))
    expect(named).toHaveLength(42)
    expect(new Set(named).size).toBe(42)
    for (const a of named) expect(AUDIT_ACTIONS as readonly string[], a).toContain(a)
  })

  it('every audited route writes to Stellr\'s chain, and reads the actor from the session', () => {
    for (const f of ROUTES) {
      const src = read(f)
      const specs = [...src.matchAll(/withAudit\(\n([\s\S]*?)\n {2}\w+,\n\)/g)].map((m) => m[1])
      for (const spec of specs) {
        expect(spec, f).toContain('actor: { session: true }')
        expect(spec, f).toContain('tenant: { stellr: true }')
      }
    }
  })
})

// ── Pages ────────────────────────────────────────────────────────────────────

describe('the pages', () => {
  const proxy = readFileSync('proxy.ts', 'utf8')

  it('guard with page.requireStellrAdmin, not the portal shell', () => {
    for (const f of PAGES) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toContain(`authz.page.requireStellrAdmin({ route: '${routeOf(f)}' })`)
      expect(src, f).not.toMatch(/requireAdminPage|page\.requireAdmin\(/)
    }
  })

  it('guard before anything else: the page\'s first statement, so no data loads for someone refused', () => {
    for (const f of PAGES) {
      const src = readFileSync(f, 'utf8')
      const body = src.match(/export default (?:async )?function \w+\([^)]*(?:\{[^}]*\}[^)]*)?\)[^{]*\{\n(.*)/)
      expect(body?.[1].trim(), f).toBe(`await authz.page.requireStellrAdmin({ route: '${routeOf(f)}' })`)
    }
  })

  // The move narrows the page guard from "admin or event manager" to "admin". That changes
  // nobody's answer only because proxy.ts already sends every event manager away from these
  // paths, so the test reads the rule it relies on.
  it('an event manager never reaches them today: proxy.ts confines them to the Events section', () => {
    const allowed = proxy.match(/isAdminEventsRoute = createRouteMatcher\(\[([^\]]+)\]\)/)?.[1] as string
    const prefixes = [...allowed.matchAll(/'(\/[^'(]+)\(\.\*\)'/g)].map((m) => m[1])
    expect(prefixes).toEqual(['/admin/competitions', '/admin/events'])
    expect(proxy).toMatch(/role === 'event_manager' && !isAdminEventsRoute\(req\)/)
    for (const f of PAGES) {
      const url = routeOf(f) as string
      for (const p of prefixes) expect(url.startsWith(p), f).toBe(false)
    }
  })
})

// ── Refusals ─────────────────────────────────────────────────────────────────

describe('every handler refuses everyone but an admin, in the same bytes', () => {
  it.each(ROUTES)('%s', async (file) => {
    const mod = await loadRoute(file)
    const methods = METHODS.filter((m) => typeof mod[m] === 'function')
    expect(methods.length, file).toBeGreaterThan(0)
    for (const method of methods) {
      for (const [who, session] of REFUSED) {
        authMock.mockResolvedValue(session)
        const body = method === 'GET' ? undefined : {}
        const res = await mod[method](request('/x', method, body), ctx())
        expect(res.status, `${method} ${who}`).toBe(403)
        expect(await res.text(), `${method} ${who}`).toBe('{"error":"Forbidden"}')
        expect(res.headers.get('content-type'), `${method} ${who}`).toContain('application/json')
      }
      expect(dbCalls, `${method} reached the database on a refusal`).not.toHaveBeenCalled()
    }
    await settled()
    expect(auditMock, 'a refusal wrote an audit event').not.toHaveBeenCalled()
  }, 60_000)
})

describe('an admin gets past the guard on every handler', () => {
  it.each(ROUTES)('%s', async (file) => {
    const mod = await loadRoute(file)
    for (const method of METHODS.filter((m) => typeof mod[m] === 'function')) {
      authMock.mockResolvedValue(ADMIN)
      // With a database that throws, a handler past its guard answers or throws: only the guard says Forbidden.
      const res = await mod[method](request('/x', method, method === 'GET' ? undefined : {}), ctx()).catch(() => null)
      if (res) expect(await res.clone().text(), method).not.toBe('{"error":"Forbidden"}')
    }
  }, 60_000)
})

// ── Audit, end to end through the real wrapper ───────────────────────────────

describe('what an audited handler writes', () => {
  const event = () => auditMock.mock.calls[0]?.[0] as Record<string, unknown>

  beforeEach(() => {
    authMock.mockResolvedValue(ADMIN)
    db = okDb()
  })

  async function run(file: string, method: string, url: string, body?: unknown) {
    const mod = await loadRoute(file)
    const res = await mod[method](request(url, method, body), ctx())
    await settled()
    return res
  }

  it('a flag resolved: the action, the signed-in admin, Stellr, the row and the outcome', async () => {
    const res = await run('app/api/admin/community/flags/route.ts', 'PATCH', '/x', { flagId: ROW, action: 'dismissed' })
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(event()).toMatchObject({
      action: 'community.flag.resolve',
      actor: 'user_admin1',
      tenantId: expect.any(String),
      target: { table: 'community_flags', id: ROW },
      metadata: expect.objectContaining({ op: 'dismissed', status: 200 }),
    })
  })

  it('an id the response alone knows: a rule created', async () => {
    await run('app/api/admin/membership/rules/route.ts', 'POST', '/x', { name: 'r', trigger_type: 'signup', grant_tier_id: ROW })
    expect(event()).toMatchObject({ action: 'membership.rule.create', target: { table: 'tier_grant_rules', id: ROW } })
  })

  it('an id on the query string: a discount deleted', async () => {
    await run('app/api/admin/entitlements/discounts/route.ts', 'DELETE', `/x?id=${ROW}`)
    expect(event()).toMatchObject({ action: 'entitlement.discount.delete', target: { table: 'discounts', id: ROW } })
  })

  it('an id from the path, and the router\'s operation', async () => {
    await run('app/api/admin/community/spaces/[id]/route.ts', 'POST', '/x', { action: 'dismiss-flag', flagId: ROW })
    expect(event()).toMatchObject({
      action: 'community.space.configure',
      target: { table: 'community_spaces', id: ROW },
      metadata: expect.objectContaining({ op: 'dismiss-flag' }),
    })
  })

  it('a router names the record the operation acted on, and who it acted on', async () => {
    await run('app/api/admin/community/mentoring/route.ts', 'POST', '/x', { action: 'removeMember', cohortId: ROW, memberId: MEMBER })
    expect(event()).toMatchObject({
      action: 'community.cohort.manage',
      target: { table: 'mentoring_cohorts', id: ROW },
      metadata: expect.objectContaining({ memberId: MEMBER }),
    })
  })

  // The sanitizer runs for real here: the mock above replaces audit(), which is what calls it.
  // A camelCase word comes out of it as [redacted], and the row can never be corrected.
  describe('every router operation survives the sanitizer under its own name', () => {
    const IDS = { cohortId: ROW, workshopId: ROW, tierId: ROW, memberId: MEMBER, memberIds: [MEMBER], newMentorId: MEMBER, newCoachId: MEMBER, coachMemberId: MEMBER }
    const MENTORING: [string, string][] = [
      ['makeMentor', 'make_mentor'], ['reassignMentor', 'reassign_mentor'], ['removeMember', 'remove_member'], ['invite', 'invite'],
      ['resendInvites', 'resend_invites'], ['updateCohort', 'update_cohort'], ['archive', 'archive'], ['delete', 'delete'], ['updateTier', 'update_tier'],
    ]
    const COACHING: [string, string][] = [
      ['create', 'create'], ['updateWorkshop', 'update_workshop'], ['reassignCoach', 'reassign_coach'], ['setMember', 'set_member'],
      ['inviteMember', 'invite_member'], ['removeMember', 'remove_member'], ['archive', 'archive'], ['delete', 'delete'], ['updateTier', 'update_tier'],
    ]

    async function storedOp(file: string, op: string) {
      const mod = await loadRoute(file)
      await mod.POST(request('/x', 'POST', { action: op, ...IDS }), ctx()).catch(() => null)
      await settled()
      return sanitizeMetadata(event()?.metadata as Record<string, unknown>).op
    }

    it.each(MENTORING)('mentoring %s', async (op, code) => {
      expect(await storedOp('app/api/admin/community/mentoring/route.ts', op)).toBe(code)
    })

    it.each(COACHING)('coaching %s', async (op, code) => {
      expect(await storedOp('app/api/admin/community/coaching/route.ts', op)).toBe(code)
    })

    it('an action named like a property of Object is an unknown operation, not a stored code', async () => {
      const res = await run('app/api/admin/community/mentoring/route.ts', 'POST', '/x', { action: 'constructor', cohortId: ROW })
      expect(res.status).toBe(400)
      expect(auditMock).not.toHaveBeenCalled()
    })
  })

  describe('a moderation or role change says what it acted on', () => {
    const SPACE = 'app/api/admin/community/spaces/[id]/route.ts'
    const sanitized = () => sanitizeMetadata(event().metadata as Record<string, unknown>)

    it.each([
      ['remove-post', { flagId: ROW }, { flagId: ROW }],
      ['dismiss-flag', { flagId: ROW }, { flagId: ROW }],
      ['mute-member', { memberId: MEMBER }, { memberId: MEMBER }],
      ['unmute-member', { memberId: MEMBER }, { memberId: MEMBER }],
      ['revoke-access', { memberId: MEMBER }, { memberId: MEMBER }],
      ['remove-member', { memberId: MEMBER }, { memberId: MEMBER }],
      ['update-member-role', { memberId: MEMBER, role: 'admin' }, { memberId: MEMBER, role: 'admin' }],
      ['update-member-role', { memberId: MEMBER, role: 'owner' }, { memberId: MEMBER, role: 'member' }],
    ])('%s %j', async (action, body, expected) => {
      await run(SPACE, 'POST', '/x', { action, ...body })
      expect(sanitized()).toMatchObject({ op: action, ...expected })
    })

    it('mute from the queue names the author it worked out, and the flag', async () => {
      await run(SPACE, 'POST', '/x', { action: 'mute-member', flagId: ROW })
      expect(sanitized()).toMatchObject({ op: 'mute-member', flagId: ROW, memberId: MEMBER })
    })

    it('a value that is not an id is left out rather than stored', async () => {
      await run(SPACE, 'POST', '/x', { action: 'remove-member', memberId: 'someone@example.test' })
      expect(JSON.stringify(event())).not.toContain('someone@example.test')
    })

    it('an invitation by email keeps the address out of the row', async () => {
      await run(SPACE, 'POST', '/x', { action: 'invite-member', email: 'someone@example.test', memberId: undefined })
      expect(JSON.stringify(event())).not.toContain('someone@example.test')
    })

    it('reassigning a mentor or a coach names who took over', async () => {
      const mentoring = await import('@/lib/mentoring')
      const reassign = vi.spyOn(mentoring, 'reassignMentor').mockResolvedValue(undefined as never)
      await run('app/api/admin/community/mentoring/route.ts', 'POST', '/x', { action: 'reassignMentor', cohortId: ROW, newMentorId: MEMBER })
      reassign.mockRestore()
      expect(sanitized()).toMatchObject({ op: 'reassign_mentor', newMentorId: MEMBER })

      auditMock.mockClear()
      const coaching = await import('@/lib/coaching')
      const coach = vi.spyOn(coaching, 'reassignCoach').mockResolvedValue(undefined as never)
      await run('app/api/admin/community/coaching/route.ts', 'POST', '/x', { action: 'reassignCoach', workshopId: ROW, newCoachId: MEMBER })
      coach.mockRestore()
      expect(sanitized()).toMatchObject({ op: 'reassign_coach', newCoachId: MEMBER })
    })
  })

  describe('a coaching match that fails after granting an award is on record', () => {
    const MATCH = 'app/api/admin/coaching/requests/[id]/match/route.ts'
    const failingUpdate = () => {
      const base = okDb()
      const reads = base.from()
      const update = { eq: () => update, then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: 'down' } }) }
      return { ...base, from: () => ({ ...reads, update: () => update }) }
    }

    it('answers a failure withAudit records, with the same body', async () => {
      const grant = grantSpy()
      db = failingUpdate()
      const res = await run(MATCH, 'POST', '/x', { coachId: MEMBER, eligibility: 'award' })
      expect(grant).toHaveBeenCalledTimes(1)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Could not match this request' })
      expect(event()).toMatchObject({ action: 'coaching.request.match', metadata: expect.objectContaining({ status: 500 }) })
    })

    it('with nothing granted, the same failure stays a refusal', async () => {
      const grant = grantSpy()
      db = failingUpdate()
      const res = await run(MATCH, 'POST', '/x', { coachId: MEMBER, eligibility: 'included' })
      expect(grant).not.toHaveBeenCalled()
      expect(res.status).toBe(400)
      expect(auditMock).not.toHaveBeenCalled()
    })
  })

  // One row per mutating handler. Three different ids, so a handler that stores the wrong one
  // fails: INPUT comes from the request, PATH from the URL, ROW only from the database's answer.
  describe('every mutating handler names its action and its target', () => {
    const CASES: [string, string, string, unknown, string, string, string | null][] = [
      ['app/api/admin/coaching/route.ts', 'POST', '/x', { coachId: MEMBER, coacheeId: INPUT }, 'coaching.workshop.ensure', 'mentoring_cohorts', ROW],
      ['app/api/admin/coaching/requests/[id]/decline/route.ts', 'POST', '/x', { reason: 'r' }, 'coaching.request.decline', 'coaching_requests', PATH],
      ['app/api/admin/coaching/requests/[id]/match/route.ts', 'POST', '/x', { coachId: MEMBER, eligibility: 'included' }, 'coaching.request.match', 'coaching_requests', PATH],
      ['app/api/admin/community/coaching/route.ts', 'POST', '/x', { action: 'create', coachMemberId: MEMBER, memberId: MEMBER }, 'community.workshop.manage', 'mentoring_cohorts', ROW],
      ['app/api/admin/community/flags/route.ts', 'PATCH', '/x', { flagId: INPUT, action: 'dismissed' }, 'community.flag.resolve', 'community_flags', INPUT],
      ['app/api/admin/community/gates/route.ts', 'POST', '/x', { type: 'prereq', targetRef: INPUT, requiresRef: ROW }, 'community.gate.set', 'training_modules', INPUT],
      ['app/api/admin/community/gates/route.ts', 'DELETE', '/x', { id: INPUT }, 'community.gate.delete', 'content_prerequisites', INPUT],
      ['app/api/admin/community/mentoring/route.ts', 'POST', '/x', { action: 'archive', cohortId: INPUT }, 'community.cohort.manage', 'mentoring_cohorts', INPUT],
      ['app/api/admin/community/resources/route.ts', 'POST', '/x', { url: 'https://example.test/a', title: 't' }, 'community.resource.create', 'community_resources', ROW],
      ['app/api/admin/community/resources/route.ts', 'PATCH', '/x', { id: INPUT, title: 't' }, 'community.resource.update', 'community_resources', INPUT],
      ['app/api/admin/community/resources/route.ts', 'DELETE', `/x?id=${INPUT}`, undefined, 'community.resource.delete', 'community_resources', INPUT],
      ['app/api/admin/community/spaces/route.ts', 'POST', '/x', { name: 'A space', slug: 'a-space' }, 'community.space.create', 'community_spaces', ROW],
      ['app/api/admin/community/spaces/route.ts', 'PATCH', '/x', { id: INPUT, name: 'A space' }, 'community.space.update', 'community_spaces', INPUT],
      ['app/api/admin/community/spaces/route.ts', 'DELETE', '/x', { id: INPUT }, 'community.space.delete', 'community_spaces', INPUT],
      ['app/api/admin/community/spaces/[id]/route.ts', 'POST', '/x', { action: 'delete-channel', channelId: INPUT }, 'community.space.configure', 'community_spaces', PATH],
      ['app/api/admin/community/spaces/[id]/resources/route.ts', 'POST', '/x', { url: 'https://example.test/a', title: 't' }, 'community.space_resource.add', 'community_spaces', PATH],
      ['app/api/admin/community/training/cert-template/route.ts', 'POST', '/x', { moduleId: INPUT, storagePath: `training/cert-templates/${INPUT}-a.pdf` }, 'training.cert_template.set', 'training_modules', INPUT],
      ['app/api/admin/community/training/cert-template/route.ts', 'DELETE', `/x?moduleId=${INPUT}`, undefined, 'training.cert_template.clear', 'training_modules', INPUT],
      ['app/api/admin/community/training/items/route.ts', 'POST', '/x', { moduleId: INPUT, title: 't', contentKind: 'live' }, 'training.item.create', 'training_items', ROW],
      ['app/api/admin/community/training/items/route.ts', 'PATCH', '/x', { id: INPUT, title: 't' }, 'training.item.update', 'training_items', INPUT],
      ['app/api/admin/community/training/items/route.ts', 'DELETE', `/x?id=${INPUT}`, undefined, 'training.item.delete', 'training_items', INPUT],
      ['app/api/admin/community/training/modules/route.ts', 'POST', '/x', { title: 't' }, 'training.module.create', 'training_modules', ROW],
      ['app/api/admin/community/training/modules/route.ts', 'PATCH', '/x', { id: INPUT, title: 't' }, 'training.module.update', 'training_modules', INPUT],
      ['app/api/admin/community/training/recording/route.ts', 'POST', '/x', { itemId: INPUT, action: 'started' }, 'training.recording.update', 'training_items', INPUT],
      ['app/api/admin/community/training/recording/route.ts', 'DELETE', `/x?itemId=${INPUT}`, undefined, 'training.recording.delete', 'training_items', INPUT],
      ['app/api/admin/community/training/resources/route.ts', 'POST', '/x', { itemId: INPUT, kind: 'link', title: 't', externalUrl: 'https://example.test/a' }, 'training.item_resource.create', 'training_item_resources', ROW],
      ['app/api/admin/community/training/resources/route.ts', 'DELETE', `/x?id=${INPUT}`, undefined, 'training.item_resource.delete', 'training_item_resources', INPUT],
      ['app/api/admin/community/training/sections/route.ts', 'POST', '/x', { moduleId: INPUT, title: 't' }, 'training.section.create', 'training_sections', ROW],
      ['app/api/admin/community/training/sections/route.ts', 'PATCH', '/x', { id: INPUT, title: 't' }, 'training.section.update', 'training_sections', INPUT],
      ['app/api/admin/community/training/sections/route.ts', 'DELETE', `/x?id=${INPUT}`, undefined, 'training.section.delete', 'training_sections', INPUT],
      ['app/api/admin/containers/[id]/contents/route.ts', 'POST', '/x', { moduleId: INPUT }, 'container.content.add', 'container_contents', ROW],
      ['app/api/admin/containers/[id]/contents/route.ts', 'DELETE', '/x', { id: INPUT }, 'container.content.remove', 'container_contents', INPUT],
      ['app/api/admin/entitlements/allocations/route.ts', 'PATCH', '/x', { id: INPUT, quantity: 1 }, 'entitlement.allocation.update', 'tier_benefits', INPUT],
      ['app/api/admin/entitlements/discounts/route.ts', 'POST', '/x', { kind: 'coupon', code: 'c' }, 'entitlement.discount.save', 'discounts', ROW],
      ['app/api/admin/entitlements/discounts/route.ts', 'DELETE', `/x?id=${INPUT}`, undefined, 'entitlement.discount.delete', 'discounts', INPUT],
      ['app/api/admin/membership/rules/route.ts', 'POST', '/x', { name: 'r', trigger_type: 'signup', grant_tier_id: INPUT }, 'membership.rule.create', 'tier_grant_rules', ROW],
      ['app/api/admin/membership/rules/route.ts', 'PATCH', '/x', { id: INPUT, name: 'r' }, 'membership.rule.update', 'tier_grant_rules', INPUT],
      ['app/api/admin/membership/rules/route.ts', 'DELETE', '/x', { id: INPUT }, 'membership.rule.delete', 'tier_grant_rules', INPUT],
      ['app/api/admin/training/assignments/route.ts', 'POST', '/x', { moduleId: INPUT, objectType: 'competition', objectRef: 'an-event' }, 'training.assignment.save', 'course_object_assignments', ROW],
      ['app/api/admin/training/assignments/route.ts', 'PATCH', '/x', { id: INPUT, dueAt: null }, 'training.assignment.update', 'course_object_assignments', INPUT],
      ['app/api/admin/training/assignments/route.ts', 'DELETE', `/x?id=${INPUT}`, undefined, 'training.assignment.delete', 'course_object_assignments', INPUT],
      ['app/api/admin/training/bulk-notify/route.ts', 'POST', '/x', { memberIds: [MEMBER], objectLabel: 'l' }, 'training.reminder.send', 'members', null],
    ]

    it('covers all of them', () => {
      const mutating = ROUTES.flatMap((f) => auditHandlers(f, readFileSync(f, 'utf8')))
      expect(CASES).toHaveLength(mutating.length)
      expect(new Set(CASES.map((c) => c[4])).size).toBe(mutating.length)
    })

    it.each(CASES)('%s %s', async (file, method, url, body, action, table, id) => {
      const mod = await loadRoute(file)
      const res = await mod[method](request(url, method, body), ctx(PATH)).catch(() => null)
      await settled()
      expect(auditMock, `no event; answered ${res?.status}`).toHaveBeenCalledTimes(1)
      expect(event()).toMatchObject({ action, target: { table, id } })
    })
  })

  it('makeMentor names the member it changed, because that is the record it acted on', async () => {
    const mentoring = await import('@/lib/mentoring')
    const grant = vi.spyOn(mentoring, 'grantMentorRole').mockResolvedValue(undefined as never)
    await run('app/api/admin/community/mentoring/route.ts', 'POST', '/x', { action: 'makeMentor', memberId: MEMBER })
    grant.mockRestore()
    expect(event()).toMatchObject({ action: 'community.cohort.manage', target: { table: 'members', id: MEMBER } })
  })

  it('a reminder records how many people, and neither who nor what it said', async () => {
    await run('app/api/admin/training/bulk-notify/route.ts', 'POST', '/x', { memberIds: [MEMBER, ROW], objectLabel: 'Secret label' })
    expect(event()).toMatchObject({ action: 'training.reminder.send', target: { table: 'members', id: null }, metadata: expect.objectContaining({ recipients: 2 }) })
    const text = JSON.stringify(event())
    expect(text).not.toContain(MEMBER)
    expect(text).not.toContain('Secret label')
  })

  it('a value that is not an id never becomes the target', async () => {
    await run('app/api/admin/community/resources/route.ts', 'PATCH', '/x', { id: 'someone@example.test', title: 'x' })
    expect(event()).toMatchObject({ target: { table: 'community_resources', id: null }, metadata: expect.objectContaining({ target_id_dropped: true }) })
    expect(JSON.stringify(event())).not.toContain('someone@example.test')
  })

  it('a refused operation writes no event, and an unknown router operation is a refusal', async () => {
    const res = await run('app/api/admin/community/spaces/[id]/route.ts', 'POST', '/x', { action: 'not-a-thing' })
    expect(res.status).toBe(400)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a handler that throws still answers as it did, and the attempt is on record', async () => {
    db = throwingDb
    const mod = await loadRoute('app/api/admin/community/training/sections/route.ts')
    await expect(mod.DELETE(request(`/x?id=${ROW}`, 'DELETE'), ctx())).rejects.toThrow('reached the database')
    await settled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(event()).toMatchObject({ action: 'training.section.delete', metadata: expect.objectContaining({ status: 500 }) })
  })
})

describe('with PLATFORM_AUDIT_ENABLED off, nothing changes', () => {
  const CASES: [string, string, string, unknown][] = [
    ['app/api/admin/community/flags/route.ts', 'PATCH', '/x', { flagId: ROW, action: 'dismissed' }],
    ['app/api/admin/membership/rules/route.ts', 'POST', '/x', { name: 'r', trigger_type: 'signup', grant_tier_id: ROW }],
    ['app/api/admin/community/spaces/[id]/route.ts', 'POST', '/x', { action: 'not-a-thing' }],
    ['app/api/admin/entitlements/discounts/route.ts', 'DELETE', `/x?id=${ROW}`, undefined],
  ]

  it.each(CASES)('%s %s answers the same, writes nothing and schedules nothing', async (file, method, url, body) => {
    authMock.mockResolvedValue(ADMIN)
    db = okDb()
    const mod = await loadRoute(file)

    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    const on = await mod[method](request(url, method, body), ctx())
    await settled()
    auditMock.mockClear()
    authMock.mockClear()

    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    const off = await mod[method](request(url, method, body), ctx())
    expect(pending).toHaveLength(0)
    expect(auditMock).not.toHaveBeenCalled()

    expect(off.status).toBe(on.status)
    expect(await off.text()).toBe(await on.text())
  })
})
