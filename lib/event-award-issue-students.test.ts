// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// awards-no-show.4: "Issue awards" reports "N awards to M students". M is the
// number of distinct students given a new or reinstated award in this run: a
// champion with an individual award too is one student, and a student whose
// award was already live, already existed, or failed is not counted.

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

const assignment = (id: string, participantId: string, awardType: string) => ({
  id, participant_id: participantId, award_type: awardType, company_id: 'co-1', assigned_at: '2026-11-01T00:00:00Z',
})

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  issueCredential: vi.fn(),
  reinstateCredential: vi.fn(),
  sendEmail: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/credentials-notify', () => ({ sendCredentialIssuedEmail: h.sendEmail }))
vi.mock('@/lib/event-certificates', () => ({
  listAssignments: async () => [
    // Ada: champion and an individual award, both new. Two awards, one student.
    assignment('a1', 'p1', 'overall_champion'),
    assignment('a2', 'p1', 'anita_gale'),
    // Ben: one new award.
    assignment('a3', 'p2', 'overall_champion'),
    // Cal: already holds this award live, so nothing to issue.
    assignment('a4', 'p3', 'overall_champion'),
    // Dee: the award was revoked earlier and is given back: reinstated.
    assignment('a5', 'p4', 'norm_chaffee'),
    // Eve: issueCredential finds the credential already there (not created).
    assignment('a6', 'p5', 'overall_champion'),
    // Fay: the issue fails.
    assignment('a7', 'p6', 'dick_edwards'),
  ],
  listEventStudents: async () => [
    student('p1', 'Ada'), student('p2', 'Ben'), student('p3', 'Cal'),
    student('p4', 'Dee'), student('p5', 'Eve'), student('p6', 'Fay'),
  ],
}))
vi.mock('@/lib/credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/credentials')>('@/lib/credentials')
  return {
    ...actual,
    issueCredential: h.issueCredential,
    reinstateCredential: h.reinstateCredential,
    eventTenantOnce: () => async () => 'tenant-own',
  }
})

const { issueAwards } = await import('./event-award-issue')
const { EVENT_AWARDS } = await import('@/lib/event-awards')

const credential = (id: string, participantId: string, awardType: string, status: string) => ({
  id, participant_id: participantId, award_type: awardType, event_slug: SLUG, source: 'event',
  status, tombstoned_at: null, tenant_id: 'tenant-own',
})

beforeEach(() => {
  vi.clearAllMocks()
  h.db = fakeSupabase({
    event_settings: [],
    credentials: [
      credential('c-p3', 'p3', 'overall_champion', 'issued'),
      credential('c-p4', 'p4', 'norm_chaffee', 'revoked'),
    ],
  })
  h.issueCredential.mockImplementation(async (_db: unknown, input: { participantId: string; awardType: string }) => {
    if (input.participantId === 'p5') return { row: credential('c-p5', 'p5', input.awardType, 'issued'), created: false }
    if (input.participantId === 'p6') throw new Error('insert failed')
    return { row: credential(`c-${input.participantId}-${input.awardType}`, input.participantId, input.awardType, 'issued'), created: true }
  })
  h.reinstateCredential.mockImplementation(async (_db: unknown, row: { id: string }) => ({ ...row, status: 'issued' }))
})

describe('issueAwards: the students count', () => {
  it('counts distinct students given a new or reinstated award', async () => {
    const r = await issueAwards(h.db.client, SLUG, { eventTitle: 'Test Event', theme: 'space' })

    expect(r.issued).toBe(3)
    expect(r.reinstated).toBe(1)
    // Ada (2 awards), Ben and Dee. Not Cal (live already), Eve (not created) or Fay (failed).
    expect(r.students).toBe(3)
    expect(r.failures).toEqual([`Fay Tester (${EVENT_AWARDS.dick_edwards.label}): insert failed`])
  })

  it('equals the distinct participants of the credentials this run created', async () => {
    const r = await issueAwards(h.db.client, SLUG, { eventTitle: 'Test Event', theme: 'space' })

    const created = await Promise.all(
      h.issueCredential.mock.results.map((res) => (res.type === 'return' ? res.value : Promise.resolve(null)).catch(() => null)),
    )
    const newIds = created
      .filter((out): out is { row: { participant_id: string }; created: boolean } => !!out && out.created)
      .map((out) => out.row.participant_id)
    const reinstatedIds = await Promise.all(h.reinstateCredential.mock.results.map(async (res) => (await res.value).participant_id))
    expect(r.students).toBe(new Set([...newIds, ...reinstatedIds]).size)
  })

  it('is zero when nothing new is awarded', async () => {
    h.issueCredential.mockResolvedValue({ row: credential('c-x', 'p1', 'overall_champion', 'issued'), created: false })
    h.reinstateCredential.mockResolvedValue(null)
    const r = await issueAwards(h.db.client, SLUG, { eventTitle: 'Test Event', theme: 'space' })

    expect(r.issued).toBe(0)
    expect(r.reinstated).toBe(0)
    expect(r.students).toBe(0)
  })
})
