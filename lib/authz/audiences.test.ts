// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeSupabase } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { eventManagerAudienceClerkIds, dutyAudienceEmails, dutyAudienceMemberIds } from './audiences'
import { AuthzLookupError } from './principal'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'

const seed = () => ({
  admin_duties: [
    { member_id: 'm-all', scopes: ['all'] },
    { member_id: 'm-comm', scopes: ['community', 'events'] },
    { member_id: 'm-events', scopes: ['events'] },
  ],
  members: [
    { id: 'm-all', email: ' All@Example.test ', is_active: true, clerk_user_id: 'c-all' },
    { id: 'm-comm', email: 'comm@example.test', is_active: true, clerk_user_id: 'c-comm' },
    { id: 'm-events', email: 'events@example.test', is_active: true, clerk_user_id: null },
    { id: 'm-gone', email: 'gone@example.test', is_active: false, clerk_user_id: 'c-gone' },
    { id: 'm-a1', email: 'a1@example.test', is_active: true, clerk_user_id: null },
    { id: 'm-a2', email: 'a2@example.test', is_active: true, clerk_user_id: 'c-a2' },
    { id: 'm-b1', email: 'b1@example.test', is_active: true, clerk_user_id: 'c-b1' },
  ],
  tenant_memberships: [
    { tenant_id: TENANT_A, member_id: 'm-a1', clerk_user_id: null, role: 'tenant_admin' },
    { tenant_id: TENANT_A, member_id: null, clerk_user_id: 'c-a2', role: 'tenant_admin' },
    { tenant_id: TENANT_A, member_id: null, clerk_user_id: 'c-mgr-a', role: 'event_manager' },
    { tenant_id: TENANT_A, member_id: 'm-comm', clerk_user_id: null, role: 'duty_holder' },
    { tenant_id: TENANT_B, member_id: null, clerk_user_id: 'c-b1', role: 'tenant_admin' },
    { tenant_id: STELLR_TENANT_ID, member_id: null, clerk_user_id: 'c-gone', role: 'tenant_admin' },
  ],
  event_manager_assignments: [
    { clerk_user_id: 'c-mgr-s', event_slug: 'colorado', tenant_id: STELLR_TENANT_ID },
    { clerk_user_id: 'c-mgr-null', event_slug: 'colorado', tenant_id: null },
    { clerk_user_id: 'c-mgr-a', event_slug: 'canary', tenant_id: TENANT_A },
    { clerk_user_id: 'c-unmapped-a', event_slug: 'canary', tenant_id: TENANT_A },
    { clerk_user_id: 'c-mgr-b', event_slug: 'mixed', tenant_id: TENANT_B },
    { clerk_user_id: 'c-mgr-a', event_slug: 'mixed', tenant_id: TENANT_A },
  ],
})

function client(fail?: string) {
  return fakeSupabase(seed(), { failOn: (t) => (t === fail ? 'boom' : null) }).client as unknown as SupabaseClient
}

describe('dutyAudienceMemberIds', () => {
  it("Stellr: holders of any named scope in admin_duties, as today's alert and digest queries", async () => {
    expect(await dutyAudienceMemberIds(client(), STELLR_TENANT_ID, ['all', 'community'])).toEqual(['m-all', 'm-comm'])
    expect(await dutyAudienceMemberIds(client(), STELLR_TENANT_ID, ['all'])).toEqual(['m-all'])
  })

  it('Stellr: reads no memberships, so a Stellr membership adds nobody', async () => {
    expect(await dutyAudienceMemberIds(client('tenant_memberships'), STELLR_TENANT_ID, ['all'])).toEqual(['m-all'])
  })

  it('Stellr: no scopes means nobody', async () => {
    expect(await dutyAudienceMemberIds(client(), STELLR_TENANT_ID, [])).toEqual([])
  })

  it("another tenant: its tenant_admins by either key, never admin_duties or a neighbour's", async () => {
    expect(await dutyAudienceMemberIds(client('admin_duties'), TENANT_A, ['all'])).toEqual(['m-a1', 'm-a2'])
    expect(await dutyAudienceMemberIds(client(), TENANT_B, ['all'])).toEqual(['m-b1'])
  })

  it('a tenant with no admins is an empty audience, not a fallback to Stellr', async () => {
    expect(await dutyAudienceMemberIds(client(), '33333333-3333-4333-8333-333333333333', ['all'])).toEqual([])
  })

  it.each([
    [STELLR_TENANT_ID, 'admin_duties'],
    [TENANT_A, 'tenant_memberships'],
    [TENANT_A, 'members'],
  ])('throws for tenant %s when %s cannot be read', async (tenant, table) => {
    await expect(dutyAudienceMemberIds(client(table), tenant, ['all'])).rejects.toBeInstanceOf(AuthzLookupError)
  })
})

describe('dutyAudienceEmails', () => {
  it('active members only, trimmed and lower-cased', async () => {
    const db = fakeSupabase({
      ...seed(),
      admin_duties: [...seed().admin_duties, { member_id: 'm-gone', scopes: ['all'] }],
    }).client as unknown as SupabaseClient
    expect(await dutyAudienceEmails(db, STELLR_TENANT_ID, ['all'])).toEqual(['all@example.test'])
  })

  it("another tenant's admins only", async () => {
    expect(await dutyAudienceEmails(client(), TENANT_A, ['all'])).toEqual(['a1@example.test', 'a2@example.test'])
  })

  it('throws when the members read fails', async () => {
    await expect(dutyAudienceEmails(client('members'), STELLR_TENANT_ID, ['all'])).rejects.toBeInstanceOf(AuthzLookupError)
  })
})

describe('eventManagerAudienceClerkIds', () => {
  it('Stellr: every assignment on the event, null tenant included, with no membership read', async () => {
    expect(await eventManagerAudienceClerkIds(client('tenant_memberships'), STELLR_TENANT_ID, 'colorado')).toEqual(['c-mgr-null', 'c-mgr-s'])
  })

  it('another tenant: an assignment and a membership in that tenant', async () => {
    expect(await eventManagerAudienceClerkIds(client(), TENANT_A, 'canary')).toEqual(['c-mgr-a'])
  })

  it('leaves out an assignment stamped for a different tenant', async () => {
    expect(await eventManagerAudienceClerkIds(client(), STELLR_TENANT_ID, 'canary')).toEqual([])
    expect(await eventManagerAudienceClerkIds(client(), TENANT_A, 'mixed')).toEqual(['c-mgr-a'])
    expect(await eventManagerAudienceClerkIds(client(), TENANT_B, 'mixed')).toEqual([])
  })

  it.each([
    [STELLR_TENANT_ID, 'colorado', 'event_manager_assignments'],
    [TENANT_A, 'canary', 'tenant_memberships'],
  ])('throws for tenant %s, event %s, when %s cannot be read', async (tenant, slug, table) => {
    await expect(eventManagerAudienceClerkIds(client(table), tenant, slug)).rejects.toBeInstanceOf(AuthzLookupError)
  })
})
