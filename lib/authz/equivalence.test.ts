/**
 * Equivalence harness for lib/authz.ts (multi-tenancy plan S5, slice C1).
 *
 * For every Stellr role scenario (Clerk claim × assignments × member row ×
 * staff_roles scopes × the owner's platform flag), every legacy idiom is run
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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allScenarios,
  fakeDb,
  isSynced,
  scenarioAuth,
  scenarioTables,
  USER,
  type FakeDb,
  type Scenario,
} from '@/test/fixtures/authz-principal'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), currentUser: vi.fn(async () => null) }))
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

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import {
  currentUserHasScope,
  currentUserIsAdmin,
  hasAdminPortalAccess,
  isAdminClaims,
  isEventManagerClaims,
  isStaffRole,
  requireAdminPage,
} from '@/lib/admin-auth'
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
    isStaffRole: isStaffRole(s.signedIn ? s.claimsRole : undefined),
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
    isStaffRole: await authz.isStaffTarget({ clerkUserId: s.signedIn ? USER : null, clerkRole: s.signedIn ? s.claimsRole : undefined }),
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
const DRIFT_SENSITIVE = /^(isEventManagerClaims|hasAdminPortalAccess|requireAdminPage|isStaffRole|requireEventAccess)/

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
        if (key === 'isStaffRole') expect([want[key], got[key]], s.name).toEqual([false, true])
        moved.add(key)
      }
    }
    // The drift is real (so a role-sync check is needed before any flip) …
    expect([...moved].sort()).toEqual([
      'hasAdminPortalAccess',
      'isEventManagerClaims',
      'isStaffRole',
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
      await authz.isStaffTarget({ clerkUserId: USER, clerkRole: s.claimsRole })
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
