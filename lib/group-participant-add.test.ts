import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  onFile: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/member-sync', () => ({ upsertMember: async () => 'member-1' }))
vi.mock('@/lib/school-link', () => ({ linkMembersToRegistrationSchool: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipationForRegistration: async () => {} }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: async () => ({}) }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => h.onFile }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/group-billing', () => ({ applyRosterChange: async () => ({ action: 'none', message: null }) }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))

import { addParticipantToGroup } from '@/lib/group-participant-add'

function db() {
  return {
    from: () => {
      let row: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, or: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: (r: Record<string, unknown>) => { h.inserted.push(r); row = { id: 'p-1', ...r }; return chain },
        single: async () => ({ data: row, error: null }),
      }
      return chain
    },
  } as never
}

const group = { id: 'reg-1', event_slug: 'nevada', event_title: 'Nevada', school_name: 'Rancho High School', school_address_state: 'NV' }
const actor = { memberId: 'staff-1', label: 'admin' }

describe('addParticipantToGroup — required roster columns (4 Nov 2026)', () => {
  beforeEach(() => { h.inserted = []; h.onFile = null })

  it('fills the group school when the form sends none (the bug that left a member with no roster row)', async () => {
    const res = await addParticipantToGroup(db(), group, {
      first_name: 'Sam', last_name: 'Student', email: 'sam@example.com', date_of_birth: '2011-05-12',
      event_role: 'participant',
    }, actor)
    expect(res.status).toBe(201)
    expect(h.inserted[0]).toMatchObject({ school_name: 'Rancho High School', phone: '', gender: '', t_shirt_size: '', age_bracket: 'high_school' })
  })

  it('gives an adult the adult bracket and keeps a school the form did send', async () => {
    await addParticipantToGroup(db(), group, {
      first_name: 'Ada', last_name: 'Adult', email: 'ada@example.com', date_of_birth: '1985-04-01',
      event_role: 'adult', school_name: 'Other School',
    }, actor)
    expect(h.inserted[0]).toMatchObject({ school_name: 'Other School', age_bracket: 'adult' })
  })

  it('turns nulls copied from a Member ID link into empty strings', async () => {
    h.onFile = {
      memberId: 'm-9', first_name: 'Lin', last_name: 'Ked', nickname: null, email: 'lin@example.com', phone: null,
      date_of_birth: '2011-05-12', grade: null, gender: null, t_shirt_size: null, ethnicity: [], dietary_requirements: [],
      health_conditions: null, event_role: 'participant',
    }
    const res = await addParticipantToGroup(db(), group, { membership_id: '0000271', linked: true }, actor)
    expect(res.status).toBe(201)
    expect(h.inserted[0]).toMatchObject({ member_id: 'm-9', phone: '', gender: '', t_shirt_size: '', school_name: 'Rancho High School' })
  })
})
