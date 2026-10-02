// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { membershipAgreementEnforced, membershipGate } from './membership-agreement'

const recent = new Date(Date.now() - 30 * 86_400_000).toISOString()
const old = new Date(Date.now() - 4 * 365 * 86_400_000).toISOString()

function setup() {
  return fakeSupabase({
    members: [
      { id: 'signed', date_of_birth: '1990-01-01', event_role: 'adult' },
      { id: 'expired', date_of_birth: '1990-01-01', event_role: 'adult' },
      { id: 'waiting', date_of_birth: '2012-01-01', event_role: 'participant' },
      { id: 'never', date_of_birth: '1990-01-01', event_role: 'adult' },
      { id: 'volunteer', date_of_birth: '1990-01-01', event_role: 'volunteer' },
      { id: 'onboarding', date_of_birth: null, event_role: null },
    ],
    agreements: [
      { member_id: 'signed', status: 'completed', envelope_type: 'membership', completed_at: recent },
      { member_id: 'expired', status: 'completed', envelope_type: 'adult', completed_at: old },
      { member_id: 'waiting', status: 'sent', envelope_type: 'membership', completed_at: null },
    ],
  })
}

afterEach(() => vi.unstubAllEnvs())

describe('membershipGate', () => {
  it('is clear with a valid signed agreement of any kind, and for volunteers and members still onboarding', async () => {
    const db = setup()
    for (const id of ['signed', 'volunteer', 'onboarding']) expect(await membershipGate(db.client, id)).toEqual({ state: 'clear' })
  })

  it('tells apart an agreement out for signature from none at all; an expired one counts as none', async () => {
    const db = setup()
    expect(await membershipGate(db.client, 'waiting')).toEqual({ state: 'awaiting_signature' })
    expect(await membershipGate(db.client, 'never')).toEqual({ state: 'not_issued' })
    expect(await membershipGate(db.client, 'expired')).toEqual({ state: 'not_issued' })
  })
})

describe('membershipAgreementEnforced', () => {
  it('is off unless switched on explicitly', () => {
    expect(membershipAgreementEnforced()).toBe(false)
    vi.stubEnv('MEMBERSHIP_AGREEMENT_ENFORCE', 'true')
    expect(membershipAgreementEnforced()).toBe(true)
  })
})
