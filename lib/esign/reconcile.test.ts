// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// group-registration-followups.2: the daily retry of refused sends works per
// person, not per "failed:" marker. One person with three markers is retried
// once, with one outcome (one alert), and all three markers go in that pass.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  reissue: vi.fn(),
  volunteer: vi.fn(async () => 'sent'),
  membership: vi.fn(async () => ({ outcome: 'sent' })),
}))

vi.mock('@/lib/docusign-agreements', () => ({ ISSUE_FAILED_PREFIX: 'failed:' }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: h.reissue }))
vi.mock('@/lib/volunteer', () => ({ dispatchVolunteerAgreement: h.volunteer, VOLUNTEER_MEMBER_COLUMNS: 'id' }))
vi.mock('@/lib/membership-agreement', () => ({ dispatchMembershipAgreement: h.membership }))

const { retryFailedIssues } = await import('./reconcile')

const NOW = new Date('2026-11-10T06:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

let n = 0
const marker = (over: { participant_id?: string | null; member_id?: string | null; envelope_type?: string; created_at: string }) => ({
  id: `mk-${++n}`,
  envelope_id: `failed:${n}`,
  envelope_type: over.envelope_type ?? 'minor',
  participant_id: over.participant_id ?? null,
  member_id: over.member_id ?? null,
  status: 'voided',
  created_at: over.created_at,
})

const markers = () => h.db.table('agreements').filter((r) => String(r.envelope_id).startsWith('failed:'))

beforeEach(() => {
  vi.clearAllMocks()
  n = 0
  h.reissue.mockResolvedValue({ kind: 'reissued', outcome: 'sent' })
})

describe('retryFailedIssues: one retry per person per pass', () => {
  it('retries a person with three markers once and clears all of them', async () => {
    h.db = fakeSupabase({
      agreements: [
        marker({ participant_id: 'p1', created_at: daysAgo(3) }),
        marker({ participant_id: 'p1', created_at: daysAgo(2) }),
        marker({ participant_id: 'p1', created_at: daysAgo(1) }),
        // An older one outside the retry window: the same person, so it goes too.
        marker({ participant_id: 'p1', created_at: daysAgo(30) }),
        // A live envelope for the same person is never touched.
        { id: 'live', envelope_id: 'env-live', envelope_type: 'minor', participant_id: 'p1', status: 'sent', created_at: daysAgo(1) },
      ],
      members: [],
    })

    const r = await retryFailedIssues(h.db.client, { now: NOW })

    expect(h.reissue).toHaveBeenCalledTimes(1)
    expect(h.reissue).toHaveBeenCalledWith(expect.anything(), 'p1', { allowNewEnvelope: true })
    expect(r).toEqual({ candidates: 1, retried: 1, outcomes: { sent: 1 } })
    expect(markers()).toEqual([])
    expect(h.db.table('agreements').map((a) => a.id)).toEqual(['live'])
  })

  it('keeps the fresh marker a failed retry records, and clears the old ones', async () => {
    h.db = fakeSupabase({
      agreements: [
        marker({ participant_id: 'p1', created_at: daysAgo(2) }),
        marker({ participant_id: 'p1', created_at: daysAgo(1) }),
      ],
    })
    h.reissue.mockImplementation(async (db: FakeDb['client'], participantId: string) => {
      // What recordIssueFailure does when the send is refused again.
      await (db as unknown as { from: (t: string) => { insert: (r: object) => Promise<unknown> } })
        .from('agreements')
        .insert({ id: 'fresh', envelope_id: 'failed:fresh', envelope_type: 'minor', participant_id: participantId, created_at: '2026-11-10T06:00:01Z' })
      return { kind: 'reissued', outcome: 'failed' }
    })

    const r = await retryFailedIssues(h.db.client, { now: NOW })

    expect(h.reissue).toHaveBeenCalledTimes(1)
    expect(r.outcomes).toEqual({ failed: 1 })
    expect(markers().map((m) => m.id)).toEqual(['fresh'])
  })

  it('retries each person once, oldest failure first, and a member agreement per type', async () => {
    h.db = fakeSupabase({
      agreements: [
        marker({ participant_id: 'p2', created_at: daysAgo(5) }),
        marker({ participant_id: 'p1', created_at: daysAgo(4) }),
        marker({ participant_id: 'p2', created_at: daysAgo(3) }),
        marker({ member_id: 'm1', envelope_type: 'volunteer', created_at: daysAgo(3) }),
        marker({ member_id: 'm1', envelope_type: 'volunteer', created_at: daysAgo(2) }),
        marker({ member_id: 'm1', envelope_type: 'membership', created_at: daysAgo(2) }),
        // A participant's marker carries the member too; it is the participant's.
        marker({ participant_id: 'p1', member_id: 'm1', envelope_type: 'adult', created_at: daysAgo(1) }),
      ],
      members: [{ id: 'm1' }],
    })

    const r = await retryFailedIssues(h.db.client, { now: NOW })

    expect(h.reissue.mock.calls.map((c) => c[1])).toEqual(['p2', 'p1'])
    expect(h.volunteer).toHaveBeenCalledTimes(1)
    expect(h.membership).toHaveBeenCalledTimes(1)
    expect(h.membership).toHaveBeenCalledWith(expect.anything(), 'm1')
    expect(r).toEqual({ candidates: 4, retried: 4, outcomes: { sent: 4 } })
    expect(markers()).toEqual([])
  })

  it('counts people, not markers, against the limit', async () => {
    h.db = fakeSupabase({
      agreements: [
        marker({ participant_id: 'p1', created_at: daysAgo(4) }),
        marker({ participant_id: 'p1', created_at: daysAgo(3) }),
        marker({ participant_id: 'p1', created_at: daysAgo(2) }),
        marker({ participant_id: 'p2', created_at: daysAgo(1) }),
      ],
    })

    const r = await retryFailedIssues(h.db.client, { now: NOW, limit: 2 })

    expect(h.reissue.mock.calls.map((c) => c[1])).toEqual(['p1', 'p2'])
    expect(r.candidates).toBe(2)
  })

  it('a dry run counts each person once and changes nothing', async () => {
    h.db = fakeSupabase({
      agreements: [
        marker({ participant_id: 'p1', created_at: daysAgo(2) }),
        marker({ participant_id: 'p1', created_at: daysAgo(1) }),
        marker({ participant_id: 'p2', created_at: daysAgo(1) }),
      ],
    })

    const r = await retryFailedIssues(h.db.client, { now: NOW, dryRun: true })

    expect(r).toEqual({ candidates: 2, retried: 0, outcomes: {} })
    expect(h.reissue).not.toHaveBeenCalled()
    expect(markers()).toHaveLength(3)
  })

  it('removes a marker that names no one, on its own, and records it as skipped', async () => {
    h.db = fakeSupabase({
      agreements: [
        marker({ created_at: daysAgo(2) }),
        marker({ created_at: daysAgo(1) }),
      ],
    })

    const r = await retryFailedIssues(h.db.client, { now: NOW })

    expect(r).toEqual({ candidates: 2, retried: 2, outcomes: { skipped: 2 } })
    expect(markers()).toEqual([])
  })
})
