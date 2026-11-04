// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// Decision 24, COPPA (review finding, 3 Nov 2026): a child whose parent has not
// consented holds a first name, date of birth and parent email, nothing more.
// PATCH /api/members/me accepted gender, phone, photo, emergency contacts and
// health data from them, and setting gender also marked onboarding complete,
// so /home and /community stopped sending them back to the waiting page.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null } }))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk-kid' }) }))
vi.mock('@/lib/impersonation', () => ({
  assertNotImpersonating: async () => null,
  impersonatedMemberId: async () => null,
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { PATCH } = await import('./route')
const { appToday } = await import('@/lib/age')

const yearsAgo = (n: number) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}
const patch = (body: unknown) =>
  PATCH(new Request('https://app.test/api/members/me', { method: 'PATCH', body: JSON.stringify(body) }))

// The migration's columns: a typo'd filter fails the test instead of matching nothing.
const SCHEMA = {
  member_pending_consent: [
    'member_id', 'band', 'guardian_name', 'guardian_email', 'requested_at', 'last_sent_at', 'consented_at',
    'purge_after', 'next_attempt_at', 'created_at',
  ],
} as const

function seed(opts: { dob: string; pending?: boolean; consentedAgreement?: boolean }) {
  state.db = fakeSupabase(
    {
      members: [{
        id: 'kid', clerk_user_id: 'clerk-kid', is_active: true, first_name: 'Sam', last_name: '',
        date_of_birth: opts.dob, gender: null, phone: null,
      }],
      member_pending_consent: opts.pending
        ? [{ member_id: 'kid', band: 'child', guardian_name: null, guardian_email: 'parent@example.test', consented_at: null }]
        : [],
      participants: [],
      agreements: opts.consentedAgreement
        ? [{ id: 'a1', member_id: 'kid', participant_id: null, envelope_type: 'minor', status: 'completed' }]
        : [],
    },
    { schema: SCHEMA },
  )
}

const memberRow = () => (state.db!.tables.members as Array<Record<string, unknown>>)[0]

beforeEach(() => { state.db = null })

describe('PATCH /api/members/me — a child awaiting a parent’s consent', () => {
  it('refuses every field, gender included, and stores nothing', async () => {
    seed({ dob: yearsAgo(12), pending: true })
    const res = await patch({ gender: 'female', phone: '555-0100', health_conditions: 'asthma' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_consent_pending')
    expect(memberRow()).toMatchObject({ gender: null, phone: null })
  })

  it('opens up once the parent has signed', async () => {
    seed({ dob: yearsAgo(12), pending: true, consentedAgreement: true })
    const res = await patch({ phone: '555-0100' })
    expect(res.status).toBe(200)
    expect(memberRow()).toMatchObject({ phone: '555-0100' })
  })

  it('a 12-year-old with no pending request (an event route) is unaffected', async () => {
    seed({ dob: yearsAgo(12) })
    expect((await patch({ phone: '555-0100' })).status).toBe(200)
  })

  it('fails closed when the pending-consent read fails', async () => {
    seed({ dob: yearsAgo(12), pending: true })
    state.db = fakeSupabase(
      { members: (state.db!.tables.members as object[]) },
      { failOn: (table) => (table === 'member_pending_consent' ? 'timeout' : null) },
    )
    expect((await patch({ phone: '555-0100' })).status).toBe(403)
  })
})
