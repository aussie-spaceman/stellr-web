// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// The script imports the event repo, which reaches Sanity; these tests are pure.
vi.mock('@/lib/events/repo', () => ({ getAllEvents: vi.fn(), getEventsForSurveySchedule: vi.fn() }))

const { rankEvents, toEventRows } = await import('./lighthouse-urls')

const today = '2026-11-05'

describe('rankEvents: cancelled and postponed events are never measured', () => {
  it('skips a cancelled or postponed event even when it would rank first', () => {
    expect(
      rankEvents(
        [
          { slug: 'cancelled', date: '2026-11-10', registrationOpen: true, status: 'cancelled' },
          { slug: 'postponed', date: '2026-11-12', registrationOpen: true, status: 'postponed' },
          { slug: 'open', date: '2026-12-01', registrationOpen: true, status: 'scheduled' },
          { slug: 'past-cancelled', date: '2026-10-01', status: 'cancelled' },
          { slug: 'past', date: '2026-09-01' },
        ],
        today,
      ),
    ).toEqual(['open', 'past'])
  })

  it('keeps rescheduled, moved-online and unset statuses', () => {
    expect(
      rankEvents(
        [
          { slug: 'rescheduled', date: '2026-11-20', registrationOpen: true, status: 'rescheduled' },
          { slug: 'online', date: '2026-11-21', registrationOpen: true, status: 'moved_online' },
          { slug: 'unset', date: '2026-11-22', registrationOpen: true, status: null },
        ],
        today,
      ),
    ).toEqual(['rescheduled', 'online', 'unset'])
  })

  it('returns nothing when every event is cancelled or postponed', () => {
    expect(
      rankEvents(
        [
          { slug: 'a', date: '2026-11-10', status: 'cancelled' },
          { slug: 'b', date: '2026-10-10', status: 'postponed' },
        ],
        today,
      ),
    ).toEqual([])
  })
})

describe('toEventRows', () => {
  it("joins each event to its status by slug, and drops an event with no date", () => {
    const rows = toEventRows(
      [
        { slug: { current: 'a' }, date: '2026-11-10', registrationOpen: true },
        { slug: { current: 'b' }, date: '2026-11-11', endDate: '2026-11-12', registrationOpen: false },
        { slug: { current: 'no-date' }, date: null },
      ],
      [
        { slug: { current: 'a' }, status: 'cancelled' },
        { slug: { current: 'other' }, status: 'postponed' },
      ],
    )
    expect(rows).toEqual([
      { slug: 'a', date: '2026-11-10', endDate: undefined, registrationOpen: true, status: 'cancelled' },
      { slug: 'b', date: '2026-11-11', endDate: '2026-11-12', registrationOpen: false, status: null },
    ])
    expect(rankEvents(rows, today)).toEqual(['b'])
  })
})
