// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S5 A10a follow-up (owner-approved 13 Nov 2026): an award issueCredential or
// reinstateCredential refuses (another organisation's event) is counted as skipped,
// with its reason, not as a failure. A withdrawn participant is still a failure.

const SLUG = 'test-event'

const student = (id: string, first: string) => ({
  id,
  member_id: null,
  first_name: first,
  last_name: 'Tester',
  email: `${id}@example.test`,
  date_of_birth: '2010-01-01',
  emergency_contact_first_name: null,
  emergency_contact_email: null,
})

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  issueCredential: vi.fn(),
  sendEmail: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/credentials-notify', () => ({ sendCredentialIssuedEmail: h.sendEmail }))
vi.mock('@/lib/event-certificates', () => ({
  listAssignments: async () => [
    { id: 'a1', participant_id: 'p1', award_type: 'anita_gale', company_id: 'co-1', assigned_at: '2026-11-01T00:00:00Z' },
    { id: 'a2', participant_id: 'p2', award_type: 'overall_champion', company_id: 'co-1', assigned_at: '2026-11-01T00:00:00Z' },
    { id: 'a3', participant_id: 'gone', award_type: 'overall_champion', company_id: 'co-1', assigned_at: '2026-11-01T00:00:00Z' },
  ],
  listEventStudents: async () => [student('p1', 'Ada'), student('p2', 'Ben')],
}))
// The real refusal class, recordSkip and reinstateCredential (which refuses another
// tenant's revoked row before writing); only a new issue is stubbed.
vi.mock('@/lib/credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/credentials')>('@/lib/credentials')
  return { ...actual, issueCredential: h.issueCredential, eventTenantOnce: () => async () => 'tenant-other' }
})

const { issueAwards } = await import('./event-award-issue')
const { CredentialNotIssuedError } = await import('@/lib/credentials')
const { EVENT_AWARDS } = await import('@/lib/event-awards')

beforeEach(() => {
  vi.clearAllMocks()
  h.db = fakeSupabase({
    event_settings: [],
    credentials: [
      // Ada's award was revoked earlier and is now given back: a reinstatement, refused
      // because the row is another tenant's.
      {
        id: 'c-p1', participant_id: 'p1', award_type: 'anita_gale', event_slug: SLUG, source: 'event',
        status: 'revoked', tombstoned_at: null, tenant_id: 'tenant-other',
      },
    ],
  })
  h.issueCredential.mockRejectedValue(new CredentialNotIssuedError('tenant_not_issuer'))
})

describe('issueAwards: refusals are skipped, not failed', () => {
  it('counts refused new and reinstated awards as skipped, and a withdrawn student as a failure', async () => {
    const r = await issueAwards(h.db.client, SLUG, { eventTitle: 'Test Event', theme: 'space' })

    expect(r.issued).toBe(0)
    expect(r.reinstated).toBe(0)
    expect(r.skipped).toBe(2)
    expect(r.skips).toEqual([
      { name: `Ada Tester (${EVENT_AWARDS.anita_gale.label})`, reason: 'tenant_not_issuer' },
      { name: `Ben Tester (${EVENT_AWARDS.overall_champion.label})`, reason: 'tenant_not_issuer' },
    ])
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toMatch(/no longer registered/)
    expect(h.sendEmail).not.toHaveBeenCalled()
    // The revoked row was not touched.
    expect(h.db.table('credentials')[0]).toMatchObject({ status: 'revoked' })
  })

  it('keeps a real error as a failure', async () => {
    h.issueCredential.mockRejectedValue(new Error('insert failed'))
    const r = await issueAwards(h.db.client, SLUG, { eventTitle: 'Test Event', theme: 'space' })

    expect(r.skipped).toBe(1)
    expect(r.skips.map((s) => s.name)).toEqual([`Ada Tester (${EVENT_AWARDS.anita_gale.label})`])
    expect(r.failures).toContain(`Ben Tester (${EVENT_AWARDS.overall_champion.label}): insert failed`)
  })
})
