// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeSupabase } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { diffRoleMapping, roleDriftCount } from '@/lib/tenancy/role-mapping'
import {
  isPlatformAdminRow,
  loadAssignmentTenantId,
  loadEventAssignees,
  loadRoleInput,
  syncEventManagerAssigned,
  syncEventManagerUnassigned,
  syncPlatformAdminGranted,
  syncPlatformAdminRevoked,
  syncDutyGranted,
  syncDutyRevoked,
  syncTenantAdminGranted,
  syncTenantAdminRevoked,
} from './role-sync'

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

// Both unique indexes on tenant_memberships are partial, which PostgREST's
// on_conflict cannot target, so a real upsert answers 42P10. Refuse it here too.
function fake(tables: Record<string, object[]> = {}, fail?: (table: string, action: string) => string | null) {
  const db = fakeSupabase(tables, {
    failOn: (table, action) => {
      if (table === 'tenant_memberships' && action === 'upsert') return 'there is no unique or exclusion constraint matching the ON CONFLICT specification'
      return fail?.(table, action) ?? null
    },
  })
  return { db, client: db.client as unknown as SupabaseClient }
}

const memberships = (db: ReturnType<typeof fakeSupabase>) => db.table('tenant_memberships')

// The Clerk admin routes act for Stellr.
const assign = (client: SupabaseClient, clerkUserId: string, slug: string) => syncEventManagerAssigned(client, clerkUserId, slug, STELLR_TENANT_ID)
const unassign = (client: SupabaseClient, clerkUserId: string, slug: string, rowTenant: string | null = null) =>
  syncEventManagerUnassigned(client, clerkUserId, slug, STELLR_TENANT_ID, rowTenant)

describe('event manager sync', () => {
  it('writes one Stellr membership, keyed by Clerk id, with an admin source', async () => {
    const { db, client } = fake()
    expect(await assign(client, 'user_m', 'colorado')).toEqual({ ok: true })
    expect(memberships(db)).toMatchObject([{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager', source: 'admin' }])
  })

  it('keeps exactly one membership however many events the person manages', async () => {
    const { db, client } = fake()
    await assign(client, 'user_m', 'colorado')
    await assign(client, 'user_m', 'nevada')
    await assign(client, 'user_m', 'colorado')
    expect(memberships(db)).toHaveLength(1)
  })

  it('removes the membership only with the last assignment', async () => {
    const { db, client } = fake({
      event_manager_assignments: [{ clerk_user_id: 'user_m', event_slug: 'nevada', tenant_id: null }],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' }],
    })
    expect(await unassign(client, 'user_m', 'colorado')).toEqual({ ok: true })
    expect(memberships(db)).toHaveLength(1)

    db.tables.event_manager_assignments = []
    expect(await unassign(client, 'user_m', 'nevada')).toEqual({ ok: true })
    expect(memberships(db)).toHaveLength(0)
  })

  it('removes only that role and that person', async () => {
    const keep = [
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'tenant_admin' },
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_x', member_id: null, role: 'event_manager' },
    ]
    const { db, client } = fake({
      tenant_memberships: [...keep, { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' }],
    })
    await unassign(client, 'user_m', 'colorado')
    expect(memberships(db)).toMatchObject(keep)
    expect(memberships(db)).toHaveLength(2)
  })

  it('does not delete when the remaining assignments cannot be read', async () => {
    const { db, client } = fake(
      { tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' }] },
      (table) => (table === 'event_manager_assignments' ? 'boom' : null),
    )
    expect((await unassign(client, 'user_m', 'colorado')).ok).toBe(false)
    expect(memberships(db)).toHaveLength(1)
  })

  it("refuses a membership in another tenant when the caller acts for Stellr, for that tenant's event", async () => {
    const { db, client } = fake({ events: [{ slug: 'canary', tenant_id: OTHER_TENANT }] })
    expect(await assign(client, 'user_m', 'canary')).toEqual({ ok: false, step: 'cross_tenant', code: 'refused' })
    expect(memberships(db)).toHaveLength(0)
  })

  it("writes into the event's own tenant when the caller is authorised for that tenant", async () => {
    const { db, client } = fake({ events: [{ slug: 'canary', tenant_id: OTHER_TENANT }] })
    expect(await syncEventManagerAssigned(client, 'user_m', 'canary', OTHER_TENANT)).toEqual({ ok: true })
    expect(memberships(db)).toMatchObject([{ tenant_id: OTHER_TENANT, role: 'event_manager' }])
  })

  it("refuses to remove another tenant's membership when the caller acts for Stellr", async () => {
    const { db, client } = fake({
      events: [{ slug: 'canary', tenant_id: OTHER_TENANT }],
      tenant_memberships: [{ tenant_id: OTHER_TENANT, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' }],
    })
    expect(await unassign(client, 'user_m', 'canary')).toEqual({ ok: false, step: 'cross_tenant', code: 'refused' })
    expect(memberships(db)).toHaveLength(1)
  })

  it("an authorised caller's unassign leaves the person's memberships in other tenants", async () => {
    const { db, client } = fake({
      events: [{ slug: 'canary', tenant_id: OTHER_TENANT }],
      event_manager_assignments: [{ clerk_user_id: 'user_m', event_slug: 'colorado', tenant_id: STELLR_TENANT_ID }],
      tenant_memberships: [
        { tenant_id: OTHER_TENANT, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' },
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' },
      ],
    })
    await syncEventManagerUnassigned(client, 'user_m', 'canary', OTHER_TENANT, null)
    expect(memberships(db)).toMatchObject([{ tenant_id: STELLR_TENANT_ID }])
    expect(memberships(db)).toHaveLength(1)
  })

  it("uses the deleted row's own tenant, so a missing mirror row cannot point the removal at Stellr", async () => {
    const { db, client } = fake({
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' }],
    })
    expect(await unassign(client, 'user_m', 'gone-from-mirror', OTHER_TENANT)).toEqual({ ok: false, step: 'cross_tenant', code: 'refused' })
    expect(memberships(db)).toHaveLength(1)
  })

  it("reads an assignment's own tenant, and answers null when the read fails so the mirror decides", async () => {
    const seed = { event_manager_assignments: [{ clerk_user_id: 'user_m', event_slug: 'canary', tenant_id: OTHER_TENANT }] }
    expect(await loadAssignmentTenantId(fake(seed).client, 'user_m', 'canary')).toBe(OTHER_TENANT)
    expect(await loadAssignmentTenantId(fake(seed).client, 'user_x', 'canary')).toBeNull()
    expect(await loadAssignmentTenantId(fake(seed, (t) => (t === 'event_manager_assignments' ? 'boom' : null)).client, 'user_m', 'canary')).toBeNull()
  })

  it("loads an event's assignees with each row's tenant, and answers null when the read fails", async () => {
    const seed = { event_manager_assignments: [{ clerk_user_id: 'user_m', event_slug: 'colorado', tenant_id: null }, { clerk_user_id: 'user_x', event_slug: 'nevada', tenant_id: null }] }
    expect(await loadEventAssignees(fake(seed).client, 'colorado')).toEqual([{ clerkUserId: 'user_m', tenantId: null }])
    expect(await loadEventAssignees(fake(seed, (t) => (t === 'event_manager_assignments' ? 'boom' : null)).client, 'colorado')).toBeNull()
  })
})

describe('staff sync', () => {
  it('is idempotent, and carries the Clerk id when the member has one', async () => {
    const { db, client } = fake({ members: [{ id: 'm1', clerk_user_id: 'user_s' }] })
    await syncDutyGranted(client, 'm1')
    await syncDutyGranted(client, 'm1')
    expect(memberships(db)).toMatchObject([{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: 'm1', role: 'duty_holder', source: 'admin' }])
    expect(memberships(db)).toHaveLength(1)
  })

  it('writes a member-keyed row for a member with no login', async () => {
    const { db, client } = fake({ members: [{ id: 'm1', clerk_user_id: null }] })
    expect(await syncDutyGranted(client, 'm1')).toEqual({ ok: true })
    expect(memberships(db)).toMatchObject([{ clerk_user_id: null, member_id: 'm1', role: 'duty_holder' }])
  })

  it('does not add a second row when one exists under the Clerk key only', async () => {
    const { db, client } = fake({
      members: [{ id: 'm1', clerk_user_id: 'user_s' }],
      tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: null, role: 'duty_holder' }],
    })
    await syncDutyGranted(client, 'm1')
    expect(memberships(db)).toHaveLength(1)
  })

  it('removes the row under either key, and leaves other roles', async () => {
    const { db, client } = fake({
      members: [{ id: 'm1', clerk_user_id: 'user_s' }],
      tenant_memberships: [
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: null, role: 'duty_holder' },
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: null, member_id: 'm1', role: 'duty_holder' },
        { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: null, role: 'event_manager' },
        { tenant_id: OTHER_TENANT, clerk_user_id: 'user_s', member_id: null, role: 'duty_holder' },
      ],
    })
    await syncDutyRevoked(client, 'm1')
    expect(memberships(db).map((m) => [m.tenant_id, m.role])).toEqual([
      [STELLR_TENANT_ID, 'event_manager'],
      [OTHER_TENANT, 'duty_holder'],
    ])
  })

  it('a failed member read still removes the member-keyed row, and is reported', async () => {
    const { db, client } = fake(
      { tenant_memberships: [{ tenant_id: STELLR_TENANT_ID, clerk_user_id: null, member_id: 'm1', role: 'duty_holder' }] },
      (table) => (table === 'members' ? 'boom' : null),
    )
    expect(await syncDutyRevoked(client, 'm1')).toEqual({ ok: false, step: 'member_read', code: 'unknown' })
    expect(memberships(db)).toHaveLength(0)
  })

  it('does not insert when a membership read fails, since a row may already exist', async () => {
    const { db, client } = fake({ members: [{ id: 'm1', clerk_user_id: 'user_s' }] }, (table, action) =>
      table === 'tenant_memberships' && action === 'select' ? 'boom' : null,
    )
    expect(await syncDutyGranted(client, 'm1')).toEqual({ ok: false, step: 'membership_read', code: 'unknown' })
    expect(memberships(db)).toHaveLength(0)
  })
})

describe('admin sync', () => {
  it('writes and removes tenant_admin, and touches no platform_admins row', async () => {
    const { db, client } = fake({ platform_admins: [{ clerk_user_id: 'user_a' }] })
    await syncTenantAdminGranted(client, 'user_a')
    await syncTenantAdminGranted(client, 'user_a')
    expect(memberships(db)).toMatchObject([{ tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', role: 'tenant_admin' }])
    expect(memberships(db)).toHaveLength(1)
    await syncTenantAdminRevoked(client, 'user_a')
    expect(memberships(db)).toHaveLength(0)
    expect(db.table('platform_admins')).toHaveLength(1)
  })

  it('platform_admins: grant, revoke and read', async () => {
    const { db, client } = fake()
    expect(await isPlatformAdminRow(client, 'user_a')).toBe(false)
    await syncPlatformAdminGranted(client, 'user_a')
    expect(db.table('platform_admins')).toMatchObject([{ clerk_user_id: 'user_a', granted_by: 'owner' }])
    expect(await isPlatformAdminRow(client, 'user_a')).toBe(true)
    await syncPlatformAdminRevoked(client, 'user_a')
    expect(db.table('platform_admins')).toHaveLength(0)
  })

  it('a failed platform_admins read is unknown, not "not an admin"', async () => {
    const { client } = fake({}, (table) => (table === 'platform_admins' ? 'boom' : null))
    expect(await isPlatformAdminRow(client, 'user_a')).toBeNull()
  })
})

describe('a failed write', () => {
  /** A client whose every call answers with this Postgres error, or throws. */
  const failing = (outcome: { code: string; message: string } | 'throw') => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'limit', 'maybeSingle', 'insert', 'delete', 'in']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      outcome === 'throw' ? reject(new Error('network: user_secret@example.test')) : resolve({ data: null, error: outcome })
    return { from: () => chain } as unknown as SupabaseClient
  }

  it('never throws, and carries a code rather than the database message', async () => {
    const results = await Promise.all([
      assign(failing({ code: '42501', message: 'denied for value user_m' }), 'user_m', 'colorado'),
      unassign(failing({ code: '42501', message: 'x' }), 'user_m', 'colorado'),
      syncDutyGranted(failing({ code: '42P01', message: 'x' }), 'm1'),
      syncDutyRevoked(failing({ code: '42P01', message: 'x' }), 'm1'),
      syncTenantAdminGranted(failing({ code: '42P01', message: 'x' }), 'user_a'),
      syncTenantAdminRevoked(failing({ code: '42P01', message: 'x' }), 'user_a'),
      syncPlatformAdminGranted(failing({ code: '42P01', message: 'x' }), 'user_a'),
      syncPlatformAdminRevoked(failing({ code: '42P01', message: 'x' }), 'user_a'),
      assign(failing('throw'), 'user_m', 'colorado'),
      syncDutyGranted(failing('throw'), 'm1'),
      syncTenantAdminGranted(failing('throw'), 'user_a'),
    ])
    for (const r of results) {
      expect(r.ok).toBe(false)
      expect(JSON.stringify(r)).not.toMatch(/user_m|user_secret|denied/)
    }
  })

  it('takes a unique violation on insert as success: a concurrent writer got there', async () => {
    const chain: Record<string, unknown> = {}
    let inserting = false
    for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain
    chain.insert = () => {
      inserting = true
      return chain
    }
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(inserting ? { data: null, error: { code: '23505', message: 'duplicate' } } : { data: [], error: null })
    const client = { from: () => chain } as unknown as SupabaseClient
    expect(await syncTenantAdminGranted(client, 'user_a')).toEqual({ ok: true })
    expect(await syncPlatformAdminGranted(client, 'user_a')).toEqual({ ok: true })
  })

  it('any other insert error is a failure', async () => {
    const { client } = fake({}, (table, action) => (table === 'tenant_memberships' && action === 'insert' ? 'boom' : null))
    expect(await syncTenantAdminGranted(client, 'user_a')).toEqual({ ok: false, step: 'membership_insert', code: 'unknown' })
  })
})

describe('the check, from a seeded database', () => {
  const seed = () => ({
    event_manager_assignments: [
      { clerk_user_id: 'user_m', event_slug: 'colorado', tenant_id: STELLR_TENANT_ID },
      { clerk_user_id: 'user_m', event_slug: 'nevada', tenant_id: null },
      { clerk_user_id: 'user_other', event_slug: 'canary', tenant_id: OTHER_TENANT },
    ],
    admin_duties: [{ member_id: 'm1', scopes: ['events'] }],
    members: [
      { id: 'm1', clerk_user_id: 'user_s' },
      { id: 'm9', clerk_user_id: 'user_nobody' },
    ],
    tenant_memberships: [
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_a', member_id: null, role: 'tenant_admin' },
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_m', member_id: null, role: 'event_manager' },
      { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'user_s', member_id: 'm1', role: 'duty_holder' },
      { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'tenant_admin' },
      { tenant_id: OTHER_TENANT, clerk_user_id: 'user_other', member_id: null, role: 'event_manager' },
    ],
    platform_admins: [{ clerk_user_id: 'user_a' }],
  })
  const clerk = [
    { id: 'user_a', role: 'admin' },
    { id: 'user_m', role: 'event_manager' },
    { id: 'user_s', role: undefined },
    { id: 'user_other', role: undefined },
  ]

  it('reads 0 drift when the mirror agrees', async () => {
    const { client } = fake(seed())
    expect(roleDriftCount(diffRoleMapping(await loadRoleInput(client, clerk)))).toBe(0)
  })

  it('reads non-zero after an out-of-band Clerk role change', async () => {
    const { client } = fake(seed())
    const changed = clerk.map((u) => (u.id === 'user_s' ? { ...u, role: 'admin' } : u))
    const drift = diffRoleMapping(await loadRoleInput(client, changed))
    expect(drift.missing).toMatchObject([{ clerk_user_id: 'user_s', role: 'tenant_admin' }])
    expect(roleDriftCount(drift)).toBeGreaterThan(0)
  })

  it('dual-written rows count as agreeing: assign, grant, then 0 drift', async () => {
    const { db, client } = fake({ members: [{ id: 'm1', clerk_user_id: 'user_s' }] })
    db.table('event_manager_assignments').push({ clerk_user_id: 'user_m', event_slug: 'colorado', tenant_id: null })
    await assign(client, 'user_m', 'colorado')
    db.table('admin_duties').push({ member_id: 'm1', scopes: ['events'] })
    await syncDutyGranted(client, 'm1')
    await syncTenantAdminGranted(client, 'user_a')
    await syncPlatformAdminGranted(client, 'user_a')
    expect(roleDriftCount(diffRoleMapping(await loadRoleInput(client, clerk)))).toBe(0)
  })

  it('reads past the row cap, so rows beyond it are still compared', async () => {
    const stale = Array.from({ length: 1200 }, (_, i) => ({ id: String(i).padStart(4, '0'), tenant_id: STELLR_TENANT_ID, clerk_user_id: `user_${i}`, member_id: null, role: 'event_manager' }))
    const db = fakeSupabase({ tenant_memberships: stale }, { maxRows: 1000 })
    const input = await loadRoleInput(db.client as unknown as SupabaseClient, [])
    expect(input.existingMemberships).toHaveLength(1200)
    expect(roleDriftCount(diffRoleMapping(input))).toBe(1200)
  })

  it('reads Clerk ids for duty holders only, so a long members table cannot drop them past the cap', async () => {
    const others = Array.from({ length: 1100 }, (_, i) => ({ id: `other${i}`, clerk_user_id: `user_${i}` }))
    const db = fakeSupabase({ admin_duties: [{ member_id: 'm1' }], members: [...others, { id: 'm1', clerk_user_id: 'user_s' }] }, { maxRows: 1000 })
    const input = await loadRoleInput(db.client as unknown as SupabaseClient, [])
    expect(input.duties).toEqual([{ member_id: 'm1', clerk_user_id: 'user_s' }])
  })

  it.each(['event_manager_assignments', 'admin_duties', 'tenant_memberships', 'platform_admins', 'members'])(
    'throws when %s cannot be read, so a failed read never looks like no drift',
    async (failed) => {
      const { client } = fake(seed(), (table) => (table === failed ? 'boom' : null))
      await expect(loadRoleInput(client, clerk)).rejects.toThrow('Read failed')
    },
  )
})
