// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity', () => ({ getEventsBySlugs: async () => [] }))

import { findGaps, type GapEnvelope, type GapParticipant } from './needs-paperwork'

const person = (id: string, over: Partial<GapParticipant> = {}): GapParticipant => ({
  id, name: `Person ${id}`, dateOfBirth: '2012-05-01', eventRole: 'student',
  eventSlug: 'co-sdc', eventTitle: 'CO SDC', eventDate: '2026-10-17', ...over,
})
const env = (participant: string, status: string, over: Partial<GapEnvelope> = {}): GapEnvelope => ({
  participant_id: participant, envelope_id: `env-${participant}-${status}`, status, issue_error: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: null, ...over,
})

describe('findGaps', () => {
  it('lists only people with nothing signed and nothing out for signature', () => {
    const gaps = findGaps(
      [person('signed'), person('waiting'), person('never'), person('failed'), person('expired'), person('declined'),
        person('redone')],
      [
        env('signed', 'completed'),
        env('waiting', 'sent'),
        env('failed', 'voided', { envelope_id: 'failed:abc', issue_error: 'DocuSign rejected the address' }),
        env('expired', 'voided'),
        env('declined', 'declined'),
        // Voided once, then reissued and now out again: not a gap.
        env('redone', 'voided', { created_at: '2026-09-01T00:00:00Z' }),
        env('redone', 'sent'),
      ],
    )
    expect(gaps.map((g) => [g.participantId, g.reason, g.detail])).toEqual([
      ['declined', 'declined', null],
      ['expired', 'voided', null],
      ['failed', 'issue_failed', 'DocuSign rejected the address'],
      ['never', 'not_issued', null],
    ])
  })

  it('lists an agreement whose email bounced, though it is still out for signature', () => {
    const gaps = findGaps([person('b')], [env('b', 'sent', { bounced: true, issue_error: 'Bounced: no such mailbox' })])
    expect(gaps.map((g) => [g.reason, g.detail])).toEqual([['bounced', 'Bounced: no such mailbox']])
  })

  it('skips people who need no agreement, and orders by event date', () => {
    const gaps = findGaps(
      [
        person('late', { eventDate: '2026-11-20' }),
        person('soon', { eventDate: '2026-10-10' }),
        person('none', { eventRole: null, dateOfBirth: null }),
      ],
      [],
    )
    expect(gaps.map((g) => g.participantId)).toEqual(['soon', 'late'])
  })
})
