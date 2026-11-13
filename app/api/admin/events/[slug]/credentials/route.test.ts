// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S5 A10a follow-up (owner-approved 13 Nov 2026): when issueCredential refuses a person
// (another organisation's event, or a consent form not yet signed), the bulk issue counts
// them as skipped, with the reason, and not as a failure. Real failures stay failures.

const SLUG = 'test-event'

const person = (id: string, first: string) => ({
  id,
  member_id: null,
  first_name: first,
  last_name: 'Tester',
  email: `${id}@example.test`,
  date_of_birth: '2010-01-01',
  event_role: 'participant',
  award: null,
  checked_in_at: '2026-11-01T10:00:00Z',
  emergency_contact_first_name: null,
  emergency_contact_email: null,
})

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  issueCredential: vi.fn(),
  sendEmail: vi.fn(async () => true),
  mentors: [] as Array<{ member_id: string; first_name: string; last_name: string; email: string; date_of_birth: string | null }>,
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => ({ ok: true }) }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ title: 'Test Event', type: 'space' }) }))
// The real refusal class and recordSkip, so the route's handling is the one production runs.
vi.mock('@/lib/credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/credentials')>('@/lib/credentials')
  return { ...actual, issueCredential: h.issueCredential, eventTenantOnce: () => async () => 'tenant-other' }
})
vi.mock('@/lib/credentials-notify', () => ({ sendCredentialIssuedEmail: h.sendEmail }))
vi.mock('@/lib/event-certificates', () => ({ listEventMentors: async () => h.mentors }))

const { POST } = await import('./route')
const { CredentialNotIssuedError } = await import('@/lib/credentials')

type Result = {
  considered: number
  created: number
  existing: number
  emailed: number
  skipped: number
  skips: Array<{ name: string; reason: string }>
  failures: string[]
}

const issue = async (body: Record<string, unknown>) => {
  const res = await POST(
    new Request(`https://app.stellreducation.org/api/admin/events/${SLUG}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: SLUG }) },
  )
  expect(res.status).toBe(200)
  return (await res.json()) as Result
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mentors = []
  h.db = fakeSupabase({
    event_settings: [],
    registrations: [
      { id: 'reg-1', event_slug: SLUG, status: 'confirmed', participants: [person('p1', 'Ada'), person('p2', 'Ben'), person('p3', 'Cal')] },
    ],
  })
})

describe('POST /api/admin/events/[slug]/credentials: refusals are skipped, not failed', () => {
  it('counts a tenant refusal as skipped with its reason, and keeps a real error as a failure', async () => {
    h.issueCredential
      .mockResolvedValueOnce({ created: true, row: { id: 'c1', number: 'STL-1' } })
      .mockRejectedValueOnce(new CredentialNotIssuedError('tenant_not_issuer'))
      .mockRejectedValueOnce(new Error('insert failed'))

    const d = await issue({ mode: 'all' })
    expect(d.considered).toBe(3)
    expect(d.created).toBe(1)
    expect(d.emailed).toBe(1)
    expect(d.skipped).toBe(1)
    expect(d.skips).toEqual([{ name: 'Ben Tester', reason: 'tenant_not_issuer' }])
    expect(d.failures).toEqual(['Cal Tester: insert failed'])
  })

  it('reports a whole refused event as skipped, with no failures', async () => {
    h.issueCredential.mockRejectedValue(new CredentialNotIssuedError('tenant_not_issuer'))

    const d = await issue({ mode: 'all' })
    expect(d.created).toBe(0)
    expect(d.skipped).toBe(3)
    expect(d.skips.every((s) => s.reason === 'tenant_not_issuer')).toBe(true)
    expect(d.failures).toEqual([])
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('skips a consent-pending participant with that reason', async () => {
    h.issueCredential
      .mockResolvedValueOnce({ created: false, row: { id: 'c1', number: 'STL-1' } })
      .mockRejectedValueOnce(new CredentialNotIssuedError('consent_pending'))
      .mockResolvedValueOnce({ created: false, row: { id: 'c3', number: 'STL-3' } })

    const d = await issue({ mode: 'all' })
    expect(d.existing).toBe(2)
    expect(d.skips).toEqual([{ name: 'Ben Tester', reason: 'consent_pending' }])
    expect(d.failures).toEqual([])
  })

  it('does the same for the mentors audience', async () => {
    h.mentors = [
      { member_id: 'm1', first_name: 'Dee', last_name: 'Mentor', email: 'm1@example.test', date_of_birth: null },
      { member_id: 'm2', first_name: 'Eli', last_name: 'Mentor', email: 'm2@example.test', date_of_birth: null },
    ]
    h.issueCredential
      .mockRejectedValueOnce(new CredentialNotIssuedError('tenant_not_issuer'))
      .mockRejectedValueOnce(new Error('insert failed'))

    const d = await issue({ audience: 'mentors' })
    expect(d.considered).toBe(2)
    expect(d.skipped).toBe(1)
    expect(d.skips).toEqual([{ name: 'Dee Mentor', reason: 'tenant_not_issuer' }])
    expect(d.failures).toEqual(['Eli Mentor: insert failed'])
  })
})
