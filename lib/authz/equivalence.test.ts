/**
 * Equivalence harness for lib/authz.ts (multi-tenancy plan S5, slice C1).
 *
 * For every Stellr role scenario (Clerk claim × assignments × member row ×
 * admin_duties scopes × the owner's platform flag), every legacy idiom is run
 * against the real legacy helper and against its lib/authz replacement:
 *
 *   clerk source     must agree with legacy in EVERY scenario. This is the
 *                    "nothing changes" guarantee for the default.
 *   postgres source  reads tenant_memberships / platform_admins written by the
 *                    S3 mapping (lib/tenancy/role-mapping.ts) from the same
 *                    data. It must agree with legacy whenever today's data is
 *                    synced. Where it is not (a Clerk event_manager with no
 *                    assignment, or an assignment without the Clerk role) the
 *                    portal / event-manager answers follow the tables; the
 *                    harness pins exactly which answers move, and that every
 *                    admin-only and scope answer still agrees.
 *
 * Since C14 lib/admin-auth.ts is a shim over lib/authz, so "legacy" here is the frozen
 * pre-C14 code in test/fixtures/authz-legacy.ts, mocked in for the module so that
 * lib/event-access and the domain wrappers run on it too. Comparing with the live module
 * would compare lib/authz with itself. The live module is held to the frozen one below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allScenarios,
  fakeDb,
  isSynced,
  MEMBER,
  scenarioAuth,
  scenarioTables,
  USER,
  type FakeDb,
  type Scenario,
} from '@/test/fixtures/authz-principal'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: vi.fn(), currentUser: vi.fn(async () => null) }))
vi.mock('@/lib/admin-auth', () => import('@/test/fixtures/authz-legacy'))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
vi.mock('@/lib/community', () => ({ getSignedInMember: vi.fn(async () => null) }))
vi.mock('@/lib/esign/native/template-admin', () => ({ TemplateAdminError: class extends Error {} }))

import { auth, clerkClient } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import {
  currentUserHasScope,
  currentUserIsAdmin,
  hasAdminPortalAccess,
  isAdminClaims,
  isEventManagerClaims,
  isCrewRole,
  requireAdminPage,
} from '@/test/fixtures/authz-legacy'
import { requireEventAccess as legacyEventAccess } from '@/lib/event-access'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { requireSurveyAdmin } from '@/lib/survey/admin-auth'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { adminName } from '@/app/api/admin/esign/templates/guard'
import * as authz from '@/lib/authz'

const SLUGS = [undefined, 'ev-a', 'ev-b', 'ev-z'] as const
const SCOPES = ['events', 'community'] as const

let db: FakeDb

function use(s: Scenario) {
  db = fakeDb(scenarioTables(s))
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(auth).mockResolvedValue(scenarioAuth(s) as never)
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'ok'
  } catch (e) {
    return e instanceof Error ? e.message : 'threw'
  }
}

/** Every legacy answer for the current scenario, by idiom name. */
async function legacy(s: Scenario): Promise<Record<string, unknown>> {
  const claims = scenarioAuth(s).sessionClaims
  const out: Record<string, unknown> = {
    isAdminClaims: isAdminClaims(claims),
    currentUserIsAdmin: await currentUserIsAdmin(),
    isEventManagerClaims: isEventManagerClaims(claims),
    hasAdminPortalAccess: hasAdminPortalAccess(claims),
    requireAdminPage: await outcome(requireAdminPage),
    isCrewRole: isCrewRole(s.signedIn ? s.claimsRole : undefined),
    requireScholarshipAdmin: (await requireScholarshipAdmin()) !== null,
    requireSurveyAdmin: await requireSurveyAdmin().then((r) => (r.ok ? 'ok' : r.response.status)),
    canManageStoreCatalog: await canManageStoreCatalog(),
    adminName: (await adminName()) !== null,
  }
  for (const slug of SLUGS) out[`requireEventAccess(${slug ?? ''})`] = await legacyEventAccess(slug)
  for (const scope of SCOPES) out[`currentUserHasScope(${scope})`] = await currentUserHasScope(scope)
  return out
}

/** Legacy has no tenant; lib/authz adds one, so it is compared without it. */
function legacyShape(access: authz.EventAccess): unknown {
  if (!access.ok) return access
  const { tenantId: _tenantId, ...rest } = access
  return rest
}

/** The lib/authz answer to each legacy idiom, under the configured source. */
async function viaAuthz(s: Scenario): Promise<Record<string, unknown>> {
  const admin = await authz.isStellrAdmin()
  const adminDecision = await authz.requireStellrAdmin()
  const section = await authz.requireEventAccess()
  const out: Record<string, unknown> = {
    isAdminClaims: admin,
    currentUserIsAdmin: admin,
    isEventManagerClaims: section.ok && !section.isAdmin,
    hasAdminPortalAccess: await authz.hasPortalAccess(),
    requireAdminPage: await outcome(() => authz.page.requireAdmin()),
    isCrewRole: await authz.isCrewTarget({ clerkUserId: s.signedIn ? USER : null, clerkRole: s.signedIn ? s.claimsRole : undefined }),
    requireScholarshipAdmin: admin,
    requireSurveyAdmin: adminDecision.ok ? 'ok' : adminDecision.status,
    canManageStoreCatalog: admin,
    adminName: admin,
  }
  for (const slug of SLUGS) out[`requireEventAccess(${slug ?? ''})`] = legacyShape(await authz.requireEventAccess(slug))
  for (const scope of SCOPES) out[`currentUserHasScope(${scope})`] = await authz.hasScope(scope)
  return out
}

/** The idioms whose postgres answer may follow the tables when data is not synced. */
const DRIFT_SENSITIVE = /^(isEventManagerClaims|hasAdminPortalAccess|requireAdminPage|isCrewRole|requireEventAccess)/

const scenarios = allScenarios()

beforeEach(() => {
  vi.stubEnv('AUTHZ_SOURCE', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authz equivalence with the legacy guard idioms', () => {
  it('covers the whole truth table', () => {
    expect(scenarios.length).toBe(151)
    expect(scenarios.filter(isSynced).length).toBeGreaterThan(60)
    expect(scenarios.filter((s) => !isSynced(s)).length).toBeGreaterThan(30)
  })

  it.each(scenarios.map((s) => [s.name, s] as const))('clerk source equals legacy: %s', async (_name, s) => {
    use(s)
    const want = await legacy(s)
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    expect(await viaAuthz(s)).toEqual(want)
  })

  it.each(scenarios.filter(isSynced).map((s) => [s.name, s] as const))(
    'postgres source equals legacy on synced data: %s',
    async (_name, s) => {
      use(s)
      const want = await legacy(s)
      vi.stubEnv('AUTHZ_SOURCE', 'postgres')
      expect(await viaAuthz(s)).toEqual(want)
    },
  )

  it('on unsynced data only the event-manager answers move, and admin and scope answers never do', async () => {
    const moved = new Set<string>()
    for (const s of scenarios.filter((x) => !isSynced(x))) {
      use(s)
      const want = await legacy(s)
      vi.stubEnv('AUTHZ_SOURCE', 'postgres')
      const got = await viaAuthz(s)
      vi.stubEnv('AUTHZ_SOURCE', '')
      for (const key of Object.keys(want)) {
        if (JSON.stringify(want[key]) === JSON.stringify(got[key])) continue
        expect(key, s.name).toMatch(DRIFT_SENSITIVE)
        // The staff-target check protects, so drift may only add protection.
        if (key === 'isCrewRole') expect([want[key], got[key]], s.name).toEqual([false, true])
        moved.add(key)
      }
    }
    // The drift is real (so a role-sync check is needed before any flip) …
    expect([...moved].sort()).toEqual([
      'hasAdminPortalAccess',
      'isCrewRole',
      'isEventManagerClaims',
      'requireAdminPage',
      'requireEventAccess()',
      'requireEventAccess(ev-a)',
      'requireEventAccess(ev-b)',
    ])
  })

  it('a Clerk event_manager with no assignment loses the portal under postgres; a stray assignment gains it', async () => {
    const em = scenarios.find((s) => s.claimsRole === 'event_manager' && s.assignments.length === 0 && s.hasMember)!
    use(em)
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    expect(await authz.hasPortalAccess()).toBe(false)

    const stray = scenarios.find((s) => s.claimsRole === 'student' && s.assignments.length === 1 && s.hasMember)!
    use(stray)
    expect(await authz.hasPortalAccess()).toBe(true)
    expect(legacyShape(await authz.requireEventAccess('ev-a'))).toEqual({ ok: true, userId: USER, isAdmin: false, assignedSlugs: ['ev-a'] })
    expect(await authz.isStellrAdmin()).toBe(false)
  })

  it('the clerk source adds no database read to claim-only decisions', async () => {
    for (const s of scenarios) {
      use(s)
      vi.stubEnv('AUTHZ_SOURCE', 'clerk')
      await authz.isStellrAdmin()
      await authz.requireStellrAdmin()
      await authz.hasPortalAccess()
      await outcome(() => authz.page.requireAdmin())
      await authz.isCrewTarget({ clerkUserId: USER, clerkRole: s.claimsRole })
      expect(db.reads, s.name).toEqual([])
    }
  })

  it('the clerk source reads assignments exactly as legacy does (event_slug only, event managers only)', async () => {
    for (const s of scenarios) {
      use(s)
      await legacyEventAccess('ev-a')
      const legacyReads = [...db.reads]
      db.reads.length = 0
      vi.stubEnv('AUTHZ_SOURCE', 'clerk')
      await authz.requireEventAccess('ev-a')
      expect(db.reads, s.name).toEqual(legacyReads)
      vi.stubEnv('AUTHZ_SOURCE', '')
    }
  })
})

describe('lib/admin-auth, the shims, answer as the frozen legacy code did', () => {
  const load = () => vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth')

  async function answers(m: Awaited<ReturnType<typeof load>>, s: Scenario) {
    const claims = scenarioAuth(s).sessionClaims
    const out: Record<string, unknown> = {
      isAdminClaims: m.isAdminClaims(claims),
      isEventManagerClaims: m.isEventManagerClaims(claims),
      hasAdminPortalAccess: m.hasAdminPortalAccess(claims),
      isCrewRole: m.isCrewRole(s.claimsRole),
      currentUserIsAdmin: await m.currentUserIsAdmin(),
      requireAdminPage: await outcome(m.requireAdminPage),
    }
    for (const scope of SCOPES) out[`currentUserHasScope(${scope})`] = await m.currentUserHasScope(scope)
    return out
  }

  it.each(scenarios.map((s) => [s.name, s] as const))('%s', async (_name, s) => {
    use(s)
    const legacyModule = await import('@/test/fixtures/authz-legacy')
    const want = await answers(legacyModule as never, s)
    const wantReads = [...db.reads]
    db.reads.length = 0
    expect(await answers(await load(), s)).toEqual(want)
    expect(db.reads).toEqual(wantReads)
  })

  it('the claim predicates take any claim shape the same way', async () => {
    const shim = await load()
    const shapes = [null, undefined, {}, { metadata: null }, { metadata: {} }, { metadata: { role: 'Admin' } }, { metadata: { role: 7 } }, { metadata: { role: ['admin'] } }]
    for (const c of shapes as Record<string, unknown>[]) {
      expect(shim.isAdminClaims(c), JSON.stringify(c)).toBe(isAdminClaims(c))
      expect(shim.isEventManagerClaims(c), JSON.stringify(c)).toBe(isEventManagerClaims(c))
      expect(shim.hasAdminPortalAccess(c), JSON.stringify(c)).toBe(hasAdminPortalAccess(c))
    }
  })

  it('isCrewRole takes any value the same way', async () => {
    const shim = await load()
    for (const v of [undefined, null, '', 'admin', 'event_manager', 'member', 'Admin', 7, ['admin'], {}]) {
      expect(shim.isCrewRole(v), String(v)).toBe(isCrewRole(v))
    }
    expect([...shim.CREW_CLERK_ROLES]).toEqual(['admin', 'event_manager'])
  })
})

describe('the view-as refusal, against the rule the start route held before C14', () => {
  type Clerk = 'no_login' | 'not_found' | 'down' | { role: unknown }
  const CLERK_STATES: Clerk[] = ['no_login', 'not_found', 'down', { role: undefined }, { role: 'admin' }, { role: 'event_manager' }, { role: 'student' }, { role: 'member' }, { role: 7 }]

  /** Word for word what app/api/admin/impersonation/route.ts answered: 403, 503, or carry on. */
  function legacyRefusal(row: 'none' | 'held' | 'read_fails', clerk: Clerk): 403 | 503 | null {
    if (row === 'read_fails') return 503
    if (row === 'held') return 403
    if (clerk === 'no_login' || clerk === 'not_found') return null
    if (clerk === 'down') return 503
    return isCrewRole(clerk.role) ? 403 : null
  }

  function target(row: 'none' | 'held' | 'read_fails', clerk: Clerk) {
    const getUser = vi.fn(async () => {
      if (clerk === 'not_found') throw Object.assign(new Error('no such user'), { status: 404 })
      if (clerk === 'down') throw Object.assign(new Error('unavailable'), { status: 503 })
      return { publicMetadata: { role: (clerk as { role: unknown }).role } }
    })
    vi.mocked(clerkClient).mockResolvedValue({ users: { getUser } } as never)
    db = fakeDb({ admin_duties: row === 'held' ? [{ member_id: MEMBER, scopes: [] }] : [] })
    if (row === 'read_fails') db.fail.add('admin_duties')
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    return { getUser, args: { memberId: MEMBER, clerkUserId: clerk === 'no_login' ? null : USER } }
  }

  async function refusal(args: { memberId: string; clerkUserId: string | null }): Promise<403 | 503 | null> {
    try {
      return (await authz.isViewAsTargetCrew(args)) ? 403 : null
    } catch {
      return 503
    }
  }

  const cases = (['none', 'held', 'read_fails'] as const).flatMap((row) => CLERK_STATES.map((clerk) => [row, clerk] as const))

  it.each(cases)('row %s, Clerk %j', async (row, clerk) => {
    const { args, getUser } = target(row, clerk)
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    expect(await refusal(args)).toBe(legacyRefusal(row, clerk))
    // The row is read first, so a holder or a failed read never reaches Clerk, as before.
    if (row !== 'none' || clerk === 'no_login') expect(getUser).not.toHaveBeenCalled()
    // And no read beyond the row: the rest is the Clerk record.
    expect(db.reads).toEqual(['admin_duties'])
  })

  it('an admin_duties row with empty scopes refuses, though isCrewTarget alone would not count it', async () => {
    const { args } = target('held', { role: 'student' })
    expect(await authz.isCrewTarget({ clerkUserId: USER, clerkRole: 'student', memberId: MEMBER })).toBe(false)
    expect(await refusal(args)).toBe(403)
  })

  it('under postgres a table role also refuses, and a failed table read is "could not confirm", not "is staff"', async () => {
    const { args } = target('none', { role: 'student' })
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    db.tables.members = [{ id: MEMBER, clerk_user_id: USER }]
    db.tables.tenant_memberships = [{ tenant_id: 'tenant', role: 'tenant_admin', member_id: MEMBER }]
    expect(await refusal(args)).toBe(403)
    db.tables.tenant_memberships = []
    expect(await refusal(args)).toBe(null)
    db.fail.add('tenant_memberships')
    expect(await refusal(args)).toBe(503)
  })

  it('under postgres a staff membership in any tenant refuses: another tenant has no admin_duties row', async () => {
    const { args } = target('none', { role: 'student' })
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    db.tables.members = [{ id: MEMBER, clerk_user_id: USER }]
    db.tables.tenant_memberships = [{ tenant_id: 'another-tenant', role: 'duty_holder', member_id: MEMBER }]
    expect(await refusal(args)).toBe(403)
  })

  it.each(['clerk', 'shadow'])('under %s a staff membership changes nothing, and is not read for this rule', async (source) => {
    const { args } = target('none', { role: 'student' })
    vi.stubEnv('AUTHZ_SOURCE', source)
    db.tables.members = [{ id: MEMBER, clerk_user_id: USER }]
    db.tables.tenant_memberships = [{ tenant_id: 'another-tenant', role: 'duty_holder', member_id: MEMBER }]
    expect(await refusal(args)).toBe(null)
  })
})
