// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { sanitizeMetadata } from '@/lib/audit/platform'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { analyzeRoute } from '@/lib/security/route-ast'
import { CLASS_REQUIREMENTS, calledFrom, satisfies } from '@/lib/security/route-guards'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// C15 (docs/TENANCY-S5.md): the platform-destined routes change class and nobody's access.
//
// Which of them become owner-only is the owner's choice, and platform_admin's check answers
// from the platform_admins table alone under AUTHZ_SOURCE=postgres, so a route in that class
// has already had the choice made for it. These stay on the guard they had, which the table
// below pins. Moving one to the platform check has to come with the owner's answer for that
// route. C25 still has to take the claim reads to lib/authz for its ratchet: moving one to
// isStellrAdmin is not that choice, and it shows here as a diff in GUARDS and CLAIM_ONLY.
//
// The refusal and access tables pass on the code from before this slice too. That is the
// proof they pin an answer rather than a mock. Only the audit events are new, and they are
// behind PLATFORM_AUDIT_ENABLED.

const ADMIN_AUTH = 'lib/admin-auth'
const AUTHZ = 'lib/authz'

/** Each handler, and the guard it had before the class moved. */
const GUARDS: [file: string, method: string, guard: string, from: string][] = [
  ['app/api/admin/deletion/route.ts', 'DELETE', 'isAdminClaims', ADMIN_AUTH],
  ['app/api/admin/deletion/preflight/route.ts', 'GET', 'isAdminClaims', ADMIN_AUTH],
  ['app/api/admin/deletion-requests/[id]/route.ts', 'PATCH', 'isAdminClaims', ADMIN_AUTH],
  ['app/api/admin/events/slug-guard/route.ts', 'GET', 'currentUserHasScope', ADMIN_AUTH],
  ['app/api/admin/impersonation/route.ts', 'POST', 'isStellrAdmin', AUTHZ],
  ['app/api/admin/members/merge/route.ts', 'GET', 'currentUserIsAdmin', ADMIN_AUTH],
  ['app/api/admin/members/merge/route.ts', 'POST', 'currentUserIsAdmin', ADMIN_AUTH],
  ['app/api/admin/privacy-requests/[id]/route.ts', 'PATCH', 'isAdminClaims', ADMIN_AUTH],
  // Staff role phase 3 (13 Nov 2026): schools moved to its capability, schools:write.
  ['app/api/admin/schools/[id]/route.ts', 'PATCH', 'hasCapability', AUTHZ],
]
/** duties compares the session claim itself. */
const INLINE_CLAIM_CHECK: [file: string, method: string][] = [
  ['app/api/admin/duties/route.ts', 'POST'],
  ['app/api/admin/duties/route.ts', 'DELETE'],
]
const FILES = [...new Set([...GUARDS.map(([f]) => f), ...INLINE_CLAIM_CHECK.map(([f]) => f)])].sort()

const factsOf = (file: string, method: string) => {
  const h = analyzeRoute(file, readFileSync(file, 'utf8')).handlers.find((x) => x.name === method)
  if (!h) throw new Error(`${file} has no ${method}`)
  return h
}

// ── Mocks ────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  executeDeletion: vi.fn(async () => ({ ok: true })),
  resolveRequest: vi.fn(async () => true),
}))
const authMock = vi.fn()
const auditMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, id: 1, seq: 1 }))
let rows: Record<string, unknown> = {}
/** Tables whose update or delete fails. */
let failWrites: string[] = []
const dbTouched = vi.fn()
/** Set once the response has gone. auth() then throws, the worst it could do inside after(). */
const phase = { afterResponse: false }

/** Answers each table with its row in `rows`, or none. */
function fakeDb() {
  const chainFor = (table: string) => {
    const row = rows[table] ?? null
    const chain: Record<string, unknown> = {}
    let writing = false
    for (const m of ['select', 'insert', 'upsert', 'eq', 'in', 'ilike']) chain[m] = () => chain
    for (const m of ['update', 'delete']) {
      chain[m] = () => {
        writing = true
        return chain
      }
    }
    chain.maybeSingle = async () => ({ data: row, error: null })
    chain.single = async () => ({ data: row, error: null })
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        writing && failWrites.includes(table)
          ? { data: null, error: { message: 'write failed' } }
          : { data: Array.isArray(row) ? row : row ? [row] : [], error: null },
      )
    return chain
  }
  return {
    from: (table: string) => {
      dbTouched(table)
      return chainFor(table)
    },
    rpc: async () => ({ data: { droppedClerkUserId: null }, error: null }),
  }
}

vi.mock('@clerk/nextjs/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  auth: () => {
    if (phase.afterResponse) throw new Error('no session after the response')
    return authMock()
  },
  currentUser: async () => null,
}))
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => fakeDb(),
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: (...args: unknown[]) => auditMock(...args),
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    phase.afterResponse = true
    pending.push(task())
  },
}))
vi.mock('@/lib/deletion/execute', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeDeletion: h.executeDeletion,
}))
vi.mock('@/lib/deletion/actor', () => ({ memberIdForClerkUser: async () => MEMBER }))
vi.mock('@/lib/deletion/external', () => ({ deleteUnsharedClerkLogin: async () => ({ kind: 'clerk', ok: true, detail: 'x' }) }))
vi.mock('@/lib/notify', () => ({ notifyMember: vi.fn(async () => {}) }))
vi.mock('@/lib/privacy-requests', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveRequest: h.resolveRequest,
}))
vi.mock('@/lib/community', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSignedInMember: async () => ({ id: MEMBER }),
}))
vi.mock('@/lib/activity-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logActivity: vi.fn(async () => {}),
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: MEMBER, actorLabel: 'Admin' }),
}))
vi.mock('@/lib/authz/role-sync', () => ({
  syncDutyGranted: async () => ({ ok: true }),
  syncDutyRevoked: async () => ({ ok: true }),
}))
vi.mock('@/lib/authz/role-sync-report', () => ({
  reportRoleSyncFailure: async () => {},
  roleSyncMetadata: () => ({}),
}))

const pending: Promise<unknown>[] = []
const MEMBER = '11111111-1111-4111-8111-111111111111'
const ROW = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

const ADMIN = { userId: 'user_admin1', sessionClaims: { metadata: { role: 'admin' } } }
const MEMBER_SESSION = { userId: 'user_member1', sessionClaims: { metadata: {} } }
const REFUSED: [string, unknown][] = [
  ['signed out', { userId: null, sessionClaims: null }],
  ['a member with no role', MEMBER_SESSION],
  ['an event manager', { userId: 'user_em1', sessionClaims: { metadata: { role: 'event_manager' } } }],
  ['a member role', { userId: 'user_crew1', sessionClaims: { metadata: { role: 'member' } } }],
]

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const load = async (file: string) => (await import(/* @vite-ignore */ `../${file}`)) as Record<string, Handler>

function call(file: string, method: string, opts: { query?: string; body?: unknown; id?: string } = {}) {
  const req = new Request(`http://localhost/x${opts.query ?? ''}`, {
    method,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body), headers: { 'content-type': 'application/json' } }),
  })
  return load(file).then((mod) => mod[method](req, { params: Promise.resolve({ id: opts.id ?? ROW }) }))
}

async function settled() {
  await Promise.all(pending.splice(0))
}

beforeEach(() => {
  authMock.mockReset()
  auditMock.mockClear()
  dbTouched.mockClear()
  h.executeDeletion.mockReset()
  h.executeDeletion.mockResolvedValue({ ok: true })
  rows = {}
  failWrites = []
  phase.afterResponse = false
  vi.stubEnv('AUTHZ_SOURCE', 'clerk')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  vi.stubEnv('IMPERSONATION_SECRET', randomBytes(32).toString('hex'))
})

afterEach(async () => {
  await settled()
  vi.unstubAllEnvs()
})

// ── The class moved ──────────────────────────────────────────────────────────

describe('the class', () => {
  it('holds the nine routes and no others', () => {
    expect(FILES).toHaveLength(9)
    const inClass = Object.entries(ROUTE_MANIFEST).filter(([, c]) => c === 'platform_destined').map(([f]) => f).sort()
    expect(inClass).toEqual(FILES)
  })

  it('asks for what stellr_only asks for, and platform_admin still asks for its own check', () => {
    expect(CLASS_REQUIREMENTS.platform_destined).toEqual(CLASS_REQUIREMENTS.stellr_only)
    expect(CLASS_REQUIREMENTS.platform_admin.kinds).toEqual(['platform'])
  })

  it('no route has moved to platform_admin: that answer is the owner\'s', () => {
    expect(Object.values(ROUTE_MANIFEST).filter((c) => c === 'platform_admin')).toEqual([])
  })
})

// ── The guard did not ────────────────────────────────────────────────────────

describe('the guard each handler had', () => {
  it.each(GUARDS)('%s %s still calls %s', (file, method, guard, from) => {
    const facts = factsOf(file, method)
    expect(calledFrom(facts, guard, [from])).toBe(true)
    const kinds = satisfies(facts)
    expect(kinds.has('admin')).toBe(true)
    expect(kinds.has('platform')).toBe(false)
  })

  it.each(INLINE_CLAIM_CHECK)('%s %s still checks the session claim itself', (file, method) => {
    const facts = factsOf(file, method)
    expect(facts.comparesRoleToAdmin).toBe(true)
    expect(satisfies(facts).has('platform')).toBe(false)
  })

  it('no file reaches the platform check', () => {
    for (const f of FILES) expect(readFileSync(f, 'utf8'), f).not.toContain('assertPlatformAdmin')
  })
})

const STELLR_ADMIN_ROWS = {
  members: { id: MEMBER },
  tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, role: 'tenant_admin' }],
}

describe('who gets in', () => {
  // [file, method, a request that stops on its own validation, once past the guard]
  const PAST_GUARD: [string, string, { query?: string; body?: unknown; id?: string }, number][] = [
    ['app/api/admin/deletion/route.ts', 'DELETE', { body: {} }, 400],
    ['app/api/admin/deletion/preflight/route.ts', 'GET', {}, 400],
    ['app/api/admin/deletion-requests/[id]/route.ts', 'PATCH', { body: {} }, 400],
    ['app/api/admin/events/slug-guard/route.ts', 'GET', {}, 400],
    ['app/api/admin/impersonation/route.ts', 'POST', { body: {} }, 400],
    ['app/api/admin/members/merge/route.ts', 'GET', {}, 400],
    ['app/api/admin/members/merge/route.ts', 'POST', { body: {} }, 400],
    ['app/api/admin/privacy-requests/[id]/route.ts', 'PATCH', { id: 'not-a-uuid', body: {} }, 404],
    ['app/api/admin/schools/[id]/route.ts', 'PATCH', { body: {} }, 400],
    ['app/api/admin/duties/route.ts', 'POST', { body: {} }, 400],
    ['app/api/admin/duties/route.ts', 'DELETE', { body: {} }, 400],
  ]

  describe.each(REFUSED)('%s', (_who, session) => {
    it.each(PAST_GUARD)('is refused by %s %s, in the same bytes', async (file, method, opts) => {
      authMock.mockResolvedValue(session)
      const res = await call(file, method, opts)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
      await settled()
      expect(auditMock).not.toHaveBeenCalled()
    })
  })

  // Under each source, because this slice must not settle what the flip takes away. The person
  // the owner's choice is about: a Stellr admin, mapped as Stellr's tenant_admin, with no
  // platform_admins row. Each of these guards answers from the Clerk claim or from
  // isStellrAdmin, and platform_admin's check would refuse this person under postgres.
  describe.each(['clerk', 'shadow', 'postgres'])('a Stellr admin under AUTHZ_SOURCE=%s, on no platform_admins list', (source) => {
    it.each(PAST_GUARD)('gets past the guard of %s %s', async (file, method, opts, expected) => {
      vi.stubEnv('AUTHZ_SOURCE', source)
      rows = STELLR_ADMIN_ROWS
      authMock.mockResolvedValue(ADMIN)
      expect((await call(file, method, opts)).status).toBe(expected)
    })
  })

  // Today's answer for someone the flip is meant to change: the Clerk admin claim still there,
  // no Stellr membership. Only the handlers that reach isStellrAdmin notice, so these routes
  // ignore the postgres source until C25 converts them, whatever class they end in.
  describe('the Clerk admin claim with no Stellr membership', () => {
    const REACHES_AUTHZ = ['app/api/admin/impersonation/route.ts', 'app/api/admin/members/merge/route.ts', 'app/api/admin/schools/[id]/route.ts']
    const CLAIM_ONLY = PAST_GUARD.filter(([file]) => !REACHES_AUTHZ.includes(file))
    const NO_MEMBERSHIP = { members: { id: MEMBER }, tenant_memberships: [] }

    it.each(CLAIM_ONLY)('postgres: still gets past %s %s, from the claim', async (file, method, opts, expected) => {
      vi.stubEnv('AUTHZ_SOURCE', 'postgres')
      rows = NO_MEMBERSHIP
      authMock.mockResolvedValue(ADMIN)
      expect((await call(file, method, opts)).status).toBe(expected)
    })

    it.each(PAST_GUARD.filter(([file]) => REACHES_AUTHZ.includes(file)))('postgres: is refused by %s %s', async (file, method, opts) => {
      vi.stubEnv('AUTHZ_SOURCE', 'postgres')
      rows = NO_MEMBERSHIP
      authMock.mockResolvedValue(ADMIN)
      expect((await call(file, method, opts)).status).toBe(403)
    })

    it.each(PAST_GUARD)('clerk: still gets past %s %s', async (file, method, opts, expected) => {
      rows = NO_MEMBERSHIP
      authMock.mockResolvedValue(ADMIN)
      expect((await call(file, method, opts)).status).toBe(expected)
    })
  })

  it('ending view-as stays open to anyone: it can only reduce access', async () => {
    authMock.mockResolvedValue(MEMBER_SESSION)
    expect((await call('app/api/admin/impersonation/route.ts', 'DELETE')).status).toBe(200)
  })

  // The route with a wider door than the others: moving it to the platform check would shut
  // out a member who edits events in Sanity Studio, under every source.
  describe('the slug guard, for a member holding a staff scope and no admin role', () => {
    const SLUG_GUARD = 'app/api/admin/events/slug-guard/route.ts'

    it('lets in the events scope and the all scope', async () => {
      authMock.mockResolvedValue(MEMBER_SESSION)
      for (const scopes of [['events'], ['all']]) {
        rows = { members: { id: MEMBER }, admin_duties: { scopes } }
        expect((await call(SLUG_GUARD, 'GET')).status, scopes[0]).toBe(400)
      }
    })

    it('refuses another scope, no scope, and no member record', async () => {
      authMock.mockResolvedValue(MEMBER_SESSION)
      for (const r of [{ members: { id: MEMBER }, admin_duties: { scopes: ['store'] } }, { members: { id: MEMBER } }, {}]) {
        rows = r
        expect((await call(SLUG_GUARD, 'GET')).status).toBe(403)
      }
    })
  })
})

// ── Audit ────────────────────────────────────────────────────────────────────

describe('audit', () => {
  const AUDITED: [file: string, method: string, action: string][] = [
    ['app/api/admin/deletion/route.ts', 'DELETE', 'deletion.entity.delete'],
    ['app/api/admin/deletion-requests/[id]/route.ts', 'PATCH', 'deletion.request.review'],
    ['app/api/admin/members/merge/route.ts', 'POST', 'member.record.merge'],
    ['app/api/admin/privacy-requests/[id]/route.ts', 'PATCH', 'privacy.request.resolve'],
    ['app/api/admin/schools/[id]/route.ts', 'PATCH', 'school.record.update'],
    ['app/api/admin/duties/route.ts', 'POST', 'duty.grant'],
    ['app/api/admin/duties/route.ts', 'DELETE', 'duty.revoke'],
  ]

  const CREW_MEMBER = { id: MEMBER, first_name: 'A', last_name: 'B', email: 'someone@example.invalid' }
  const SUCCESS: Record<string, { opts: { body?: unknown; id?: string }; rows?: Record<string, unknown>; answer: unknown; target: { table: string; id: string }; metadata: Record<string, unknown> }> = {
    'deletion.entity.delete': {
      opts: { body: { entity: 'school', id: ROW, mode: 'hard', refundChoice: 'none', refundNote: 'A private reason' } },
      answer: { ok: true },
      target: { table: 'schools', id: ROW },
      metadata: { entity: 'school', mode: 'hard', refundChoice: 'none' },
    },
    'deletion.request.review': {
      opts: { body: { action: 'reject', note: 'A private reason' } },
      rows: { deletion_requests: { id: ROW, entity_type: 'school', entity_id: OTHER, status: 'pending', requested_by: null } },
      answer: { success: true, status: 'rejected' },
      target: { table: 'deletion_requests', id: ROW },
      metadata: { decision: 'reject', entity: 'school', entityId: OTHER },
    },
    'member.record.merge': {
      opts: { body: { keepId: MEMBER, dropId: OTHER, fields: {} } },
      rows: { members: [{ id: MEMBER, clerk_user_id: 'user_a', email: 'kept@example.invalid', first_name: 'A', last_name: 'B', date_of_birth: '2000-01-01' }, { id: OTHER, clerk_user_id: null }] },
      answer: { ok: true, keptMemberId: MEMBER, result: { droppedClerkUserId: null }, login: { kind: 'clerk', ok: true, detail: 'No login on the removed record' } },
      target: { table: 'members', id: MEMBER },
      metadata: { dropId: OTHER },
    },
    'privacy.request.resolve': {
      opts: { body: { status: 'completed', note: 'A private reason' } },
      answer: { ok: true },
      target: { table: 'privacy_requests', id: ROW },
      metadata: { resolution: 'completed' },
    },
    'school.record.update': {
      opts: { body: { name: 'A school' } },
      rows: { schools: { id: ROW, name: 'A school' } },
      answer: { school: { id: ROW, name: 'A school' } },
      target: { table: 'schools', id: ROW },
      metadata: {},
    },
    'duty.grant': {
      opts: { body: { email: 'someone@example.invalid', scopes: ['events'] } },
      rows: { members: CREW_MEMBER },
      answer: { ok: true, member: CREW_MEMBER },
      target: { table: 'admin_duties', id: MEMBER },
      metadata: { scopes: ['events'] },
    },
    'duty.revoke': {
      opts: { body: { memberId: MEMBER } },
      answer: { ok: true },
      target: { table: 'admin_duties', id: MEMBER },
      metadata: {},
    },
  }

  type Event = { action: string; actor: string; target: unknown; metadata: Record<string, unknown>; tenantId: string }
  const lastEvent = () => auditMock.mock.calls.at(-1)?.[0] as Event

  it('every mutating handler audits on every path, under the gate, except the end of view-as', () => {
    const mutating = FILES.flatMap((f) => auditHandlers(f, readFileSync(f, 'utf8')))
    const open = mutating.filter((m) => !m.audited).map((m) => m.key)
    expect(open).toEqual(['app/api/admin/impersonation/route.ts#DELETE'])
    for (const [file, method] of AUDITED) {
      expect(mutating.find((m) => m.key === `${file}#${method}`), `${file} ${method}`).toMatchObject({ audited: true, coverage: 'mandatory' })
    }
  })

  it('every action is in the catalogue', () => {
    for (const [, , action] of AUDITED) expect(AUDIT_ACTIONS as readonly string[], action).toContain(action)
  })

  it.each(AUDITED)('%s %s writes one %s event, with ids and codes only', async (file, method, action) => {
    const s = SUCCESS[action]
    rows = s.rows ?? {}
    authMock.mockResolvedValue(ADMIN)
    const res = await call(file, method, s.opts)
    expect(res.status, await res.clone().text()).toBe(200)
    await settled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    const event = lastEvent()
    expect(event.action).toBe(action)
    // The handler's verified user, with no session to read once the response has gone.
    expect(event.actor).toBe(ADMIN.userId)
    expect(event.metadata).not.toHaveProperty('actor_unresolved')
    // Stellr's chain until the owner answers (lib/security/stellr-only-dispositions.ts). A
    // row on the wrong chain cannot be corrected, so a change here is a decision, not a fix.
    expect(event.tenantId).toBe(STELLR_TENANT_ID)
    expect(event.target).toEqual(s.target)
    expect(event.metadata).toEqual({ ...s.metadata, status: 200 })
    // The real sanitiser keeps every key and value: this test's event is what gets stored.
    expect(sanitizeMetadata(event.metadata)).toEqual(event.metadata)
    // Free text and addresses from the request stay out of a row that can never be erased.
    expect(JSON.stringify(event)).not.toMatch(/private reason|example\.invalid|A school/)
  })

  it.each(AUDITED)('%s %s answers the same and writes nothing with the flag off', async (file, method, action) => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    const s = SUCCESS[action]
    rows = s.rows ?? {}
    authMock.mockResolvedValue(ADMIN)
    const res = await call(file, method, s.opts)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(s.answer)
    await settled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  describe('a reviewed deletion says what it acted on', () => {
    const REVIEW = 'app/api/admin/deletion-requests/[id]/route.ts'
    const pendingRequest = (entity_type: string, entity_id: string) => ({
      deletion_requests: { id: ROW, entity_type, entity_id, status: 'pending', requested_by: MEMBER },
    })

    it('an approved deletion names the entity and the mode that ran', async () => {
      rows = pendingRequest('session', OTHER)
      authMock.mockResolvedValue(ADMIN)
      const res = await call(REVIEW, 'PATCH', { body: { action: 'approve', mode: 'hard' } })
      expect(await res.json()).toEqual({ success: true, status: 'approved' })
      expect(h.executeDeletion).toHaveBeenCalledTimes(1)
      await settled()
      expect(lastEvent().metadata).toEqual({ decision: 'approve', entity: 'session', entityId: OTHER, mode: 'hard', status: 200 })
    })

    it('an approved school removes the link, deletes nothing, and records no mode', async () => {
      rows = pendingRequest('school', OTHER)
      authMock.mockResolvedValue(ADMIN)
      await call(REVIEW, 'PATCH', { body: { action: 'approve', mode: 'hard' } })
      expect(h.executeDeletion).not.toHaveBeenCalled()
      await settled()
      expect(lastEvent().metadata).toEqual({ decision: 'approve', entity: 'school', entityId: OTHER, linkOnly: true, status: 200 })
    })

    it('an event is named by its slug, not stored as an id', async () => {
      rows = pendingRequest('event', 'a-slug')
      authMock.mockResolvedValue(ADMIN)
      await call(REVIEW, 'PATCH', { body: { action: 'approve' } })
      await settled()
      expect(lastEvent().metadata).toEqual({ decision: 'approve', entity: 'event', entityId: null, eventSlug: 'a-slug', mode: 'soft', status: 200 })
    })

    // The answer predates this slice and stays as it is. The row must not read as clean.
    it.each([
      ['reject', 'school', 'deletion_requests', 'requestUpdateFailed', 'rejected'],
      ['approve', 'session', 'deletion_requests', 'requestUpdateFailed', 'approved'],
      ['approve', 'school', 'member_schools', 'linkDeleteFailed', 'approved'],
    ])('%s of a %s: a failed write to %s answers as before and the row says %s', async (action, entity, table, flag, status) => {
      rows = pendingRequest(entity, OTHER)
      failWrites = [table]
      authMock.mockResolvedValue(ADMIN)
      const res = await call(REVIEW, 'PATCH', { body: { action } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, status })
      await settled()
      expect(lastEvent().metadata).toMatchObject({ [flag]: true, status: 200 })
    })
  })

  it('a blocked deletion is a refusal: its 409 and blockers pass through and no event is written', async () => {
    const { DeletionBlockedError } = await import('@/lib/deletion/execute')
    h.executeDeletion.mockRejectedValue(Object.assign(Object.create(DeletionBlockedError.prototype), { blockers: ['x'] }))
    authMock.mockResolvedValue(ADMIN)
    const res = await call('app/api/admin/deletion/route.ts', 'DELETE', { body: { entity: 'school', id: ROW } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Deletion blocked', blockers: ['x'] })
    await settled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a deletion that fails part way is recorded, with its status', async () => {
    h.executeDeletion.mockRejectedValue(new Error('It failed'))
    authMock.mockResolvedValue(ADMIN)
    const res = await call('app/api/admin/deletion/route.ts', 'DELETE', { body: { entity: 'school', id: ROW } })
    expect(res.status).toBe(500)
    await settled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect((auditMock.mock.calls[0][0] as { metadata: unknown }).metadata).toMatchObject({ entity: 'school', status: 500 })
  })

  it('an event\'s slug is not stored as its id: the row says it was dropped, and names the event', async () => {
    authMock.mockResolvedValue(ADMIN)
    await call('app/api/admin/deletion/route.ts', 'DELETE', { body: { entity: 'event', id: 'a-slug' } })
    await settled()
    const event = lastEvent()
    expect(event.target).toEqual({ table: 'event_settings', id: null })
    expect(event.metadata).toMatchObject({ entity: 'event', eventSlug: 'a-slug', target_id_dropped: true })
    expect(sanitizeMetadata(event.metadata).eventSlug).toBe('a-slug')
  })
})
