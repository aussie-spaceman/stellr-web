import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { recordEventParticipation, recordEventParticipationForRegistration } from '@/lib/event-participation-sync'
import { reconcileEventSpaceRoster as realReconcile, syncObjectSpaceRoster as realSync } from '@/lib/space-inheritance'
import { autoGrantBaseMembership as realGrant } from '@/lib/auto-membership-grant'
import {
  linkMembersToRegistrationSchool as realLinkRegistration,
  linkMembersToSchoolByName as realLink,
  resolveAndLinkSchool as realResolve,
} from '@/lib/school-link'
import { syncMemberOptionSelections as realSyncOptions } from '@/lib/member-profile-options'
import * as hooks from './event-hooks'

// The real Space, cohort and participation code against a fake database, so these
// tests see the rows. The school, profile, membership and activity modules have their
// own suites and are stubbed here: those cases check the call, and that it never
// happens for a Canary event.
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: vi.fn(async () => {}) }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: vi.fn(async () => {}) }))
vi.mock('@/lib/school-link', () => ({
  linkMembersToSchoolByName: vi.fn(async () => {}),
  linkMembersToRegistrationSchool: vi.fn(async () => {}),
  resolveAndLinkSchool: vi.fn(async () => ({ id: 'school-1', state: 'NV' })),
}))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: vi.fn(async () => {}) }))

const STELLR = { isPlatformOwner: true }
const CANARY = { isPlatformOwner: false }

const MEMBER = 'mem-1'
const SLUG = 'canary-or-stellr-event'
const REG = 'reg-1'

function seeded(): FakeDb {
  return fakeSupabase({
    registrations: [{ id: REG, event_slug: SLUG, event_title: 'The Event', school_name: 'A School', teacher_email: 'teacher@example.com' }],
    community_space_sources: [{ space_id: 'space-1', object_type: 'event', object_ref: SLUG }],
    community_space_members: [],
    mentoring_cohorts: [],
    cohort_members: [],
    event_participations: [],
  })
}

const client = (db: FakeDb) => db.client as unknown as Parameters<typeof hooks.recordParticipation>[1]

/** Every table with rows, ids and timestamps dropped, so two runs can be compared. */
function written(db: FakeDb): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const [name, rows] of Object.entries(db.tables)) {
    if (name === 'registrations' || name === 'community_space_sources') continue
    out[name] = rows.map((row) => {
      const { id: _id, created_at: _c, updated_at: _u, parent_container_id: _p, cohort_id: _k, ...rest } = row as Record<string, unknown>
      return rest
    })
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
})

const PARTICIPATION = { memberId: MEMBER, eventSlug: SLUG, eventTitle: 'The Event', eventYear: 2027, registrationId: REG }

describe('recordParticipation', () => {
  it('Stellr: writes exactly what the direct call writes, roster and Space included', async () => {
    const direct = seeded()
    await recordEventParticipation(client(direct), PARTICIPATION)

    const viaHook = seeded()
    await hooks.recordParticipation(STELLR, client(viaHook), PARTICIPATION)

    expect(written(viaHook)).toEqual(written(direct))
    // Not vacuous: the direct call really wrote the rows the Canary case must not.
    expect(direct.table('community_space_members')).toHaveLength(1)
    expect(direct.table('cohort_members')).toHaveLength(1)
    expect(direct.table('event_participations')).toHaveLength(1)
  })

  it('Canary: writes nothing at all: no row, no activity entry, no Space, cohort or grant', async () => {
    const db = seeded()
    await hooks.recordParticipation(CANARY, client(db), PARTICIPATION)

    expect(db.table('event_participations')).toEqual([])
    expect(db.table('community_space_members')).toEqual([])
    expect(db.table('cohort_members')).toEqual([])
    expect(db.table('mentoring_cohorts')).toEqual([])
    const { applyGrantTrigger } = await import('@/lib/membership-grants')
    const { logActivity } = await import('@/lib/activity-log')
    expect(applyGrantTrigger).not.toHaveBeenCalled()
    expect(logActivity).not.toHaveBeenCalled()
  })
})

// The team-leader and roster-sheet paths act on a registration by id from Stellr's
// own host, so no hook context reaches them and the tenant comes from the row.
describe('recordEventParticipationForRegistration', () => {
  const withTenant = (tenant_id: string | null) => {
    const db = seeded()
    db.table('registrations')[0].tenant_id = tenant_id
    return db
  }

  it.each([
    ['Stellr', STELLR_TENANT_ID],
    ['no tenant yet', null],
  ])('%s: the same rows as the direct call', async (_name, tenant) => {
    const db = withTenant(tenant)
    await recordEventParticipationForRegistration(client(db), REG, [MEMBER, MEMBER, null])
    expect(db.table('event_participations')).toMatchObject([{ member_id: MEMBER, event_slug: SLUG }])
    expect(db.table('community_space_members')).toHaveLength(1)
    expect(db.table('cohort_members')).toHaveLength(1)
  })

  it('another tenant: writes nothing, and grants nothing', async () => {
    const db = withTenant('00000000-0000-4000-8000-00000000000c')
    await recordEventParticipationForRegistration(client(db), REG, [MEMBER])
    expect(db.table('event_participations')).toEqual([])
    expect(db.table('community_space_members')).toEqual([])
    expect(db.table('cohort_members')).toEqual([])
    const { applyGrantTrigger } = await import('@/lib/membership-grants')
    expect(applyGrantTrigger).not.toHaveBeenCalled()
  })

  it('a failed registration read writes nothing, whoever it belongs to', async () => {
    const db = fakeSupabase(
      { registrations: [{ id: REG, event_slug: SLUG }], event_participations: [], community_space_members: [] },
      { failOn: (t) => (t === 'registrations' ? 'timeout' : null) },
    )
    await recordEventParticipationForRegistration(client(db), REG, [MEMBER])
    expect(db.table('event_participations')).toEqual([])
    expect(db.table('community_space_members')).toEqual([])
  })
})

describe('the Space roster hooks', () => {
  it('syncObjectSpaceRoster, Stellr: the same row as the direct call', async () => {
    const direct = seeded()
    await realSync(client(direct), 'event', SLUG, MEMBER)
    const viaHook = seeded()
    await hooks.syncObjectSpaceRoster(STELLR, client(viaHook), 'event', SLUG, MEMBER)
    expect(written(viaHook)).toEqual(written(direct))
    expect(direct.table('community_space_members')).toMatchObject([{ space_id: 'space-1', member_id: MEMBER, role: 'member', status: 'active' }])
  })

  it('syncObjectSpaceRoster, Canary: no row', async () => {
    const db = seeded()
    await hooks.syncObjectSpaceRoster(CANARY, client(db), 'event', SLUG, MEMBER)
    expect(db.table('community_space_members')).toEqual([])
  })

  const rostered = () => {
    const db = seeded()
    db.table('mentoring_cohorts').push({ id: 'cohort-1', container_type: 'event_participation', campaign_ref: SLUG })
    db.table('cohort_members').push({ cohort_id: 'cohort-1', member_id: MEMBER, status: 'active' })
    return db
  }

  it('reconcileEventSpaceRoster, Stellr: the same rows as the direct call', async () => {
    const direct = rostered()
    await realReconcile(client(direct), SLUG)
    const viaHook = rostered()
    await hooks.reconcileEventSpaceRoster(STELLR, client(viaHook), SLUG)
    expect(written(viaHook)).toEqual(written(direct))
    expect(direct.table('community_space_members')).toHaveLength(1)
  })

  it('reconcileEventSpaceRoster, Canary: no row', async () => {
    const db = rostered()
    await hooks.reconcileEventSpaceRoster(CANARY, client(db), SLUG)
    expect(db.table('community_space_members')).toEqual([])
  })
})

describe('the membership, school and profile hooks', () => {
  const SCHOOL = { name: 'A School', address_street: null, address_city: null, address_state: null, address_zip: null }
  const OPTIONS = [{ memberId: MEMBER, ethnicity: ['A'], dietary: ['B'] }]

  it('Stellr: passes every argument through', async () => {
    const db = client(seeded())
    await hooks.autoGrantBaseMembership(STELLR, db, MEMBER)
    expect(realGrant).toHaveBeenCalledExactlyOnceWith(db, MEMBER)
    await hooks.linkMembersToSchoolByName(STELLR, db, [MEMBER], SCHOOL, { replace: true })
    expect(realLink).toHaveBeenCalledExactlyOnceWith(db, [MEMBER], SCHOOL, { replace: true })
    await hooks.linkMembersToRegistrationSchool(STELLR, db, REG, [MEMBER])
    expect(realLinkRegistration).toHaveBeenCalledExactlyOnceWith(db, REG, [MEMBER])
    await expect(hooks.resolveAndLinkSchool(STELLR, db, [MEMBER], SCHOOL)).resolves.toEqual({ id: 'school-1', state: 'NV' })
    expect(realResolve).toHaveBeenCalledExactlyOnceWith(db, [MEMBER], SCHOOL)
    await hooks.syncMemberOptionSelections(STELLR, db, OPTIONS)
    expect(realSyncOptions).toHaveBeenCalledExactlyOnceWith(db, OPTIONS)
  })

  it('Canary: calls none of them', async () => {
    const db = client(seeded())
    await hooks.autoGrantBaseMembership(CANARY, db, MEMBER)
    await hooks.linkMembersToSchoolByName(CANARY, db, [MEMBER], SCHOOL)
    await hooks.linkMembersToRegistrationSchool(CANARY, db, REG, [MEMBER])
    await expect(hooks.resolveAndLinkSchool(CANARY, db, [MEMBER], SCHOOL)).resolves.toBeNull()
    await hooks.syncMemberOptionSelections(CANARY, db, OPTIONS)
    expect(realGrant).not.toHaveBeenCalled()
    expect(realLink).not.toHaveBeenCalled()
    expect(realLinkRegistration).not.toHaveBeenCalled()
    expect(realResolve).not.toHaveBeenCalled()
    expect(realSyncOptions).not.toHaveBeenCalled()
  })
})

describe('every hook', () => {
  it('is on this list, so a new one needs its Canary case above', () => {
    expect(Object.keys(hooks).sort()).toEqual([
      'autoGrantBaseMembership',
      'linkMembersToRegistrationSchool',
      'linkMembersToSchoolByName',
      'reconcileEventSpaceRoster',
      'recordParticipation',
      'resolveAndLinkSchool',
      'syncMemberOptionSelections',
      'syncObjectSpaceRoster',
    ])
  })

  it('treats anything but a positive answer as not Stellr', async () => {
    const db = seeded()
    const notAnswers = [{ isPlatformOwner: undefined }, { isPlatformOwner: null }, { isPlatformOwner: 'true' }, {}]
    for (const event of notAnswers) {
      await hooks.syncObjectSpaceRoster(event as never, client(db), 'event', SLUG, MEMBER)
      await hooks.recordParticipation(event as never, client(db), PARTICIPATION)
    }
    expect(db.table('community_space_members')).toEqual([])
    expect(db.table('cohort_members')).toEqual([])
    expect(db.table('event_participations')).toEqual([])
  })
})
