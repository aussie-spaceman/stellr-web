import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// hubspot-event-options.8: with no year given, the event_participations row is
// filed under the school year (schoolYearFor, rolls over in August), not the
// calendar year, so it matches HubSpot's event_year and the survey's.

vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: vi.fn() }))
vi.mock('@/lib/container-sync', () => ({ ensureRosterMembership: vi.fn() }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: vi.fn() }))

const { recordEventParticipation } = await import('./event-participation-sync')

let inserted: Record<string, unknown>[]

function db() {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row)
          return { error: null }
        },
      }
      return chain
    },
  } as unknown as Parameters<typeof recordEventParticipation>[0]
}

async function yearRecordedAt(iso: string, eventYear?: number | null): Promise<unknown> {
  vi.setSystemTime(new Date(iso))
  await recordEventParticipation(db(), { memberId: 'mem1', eventSlug: 'evt', eventYear })
  return inserted.at(-1)?.event_year
}

beforeEach(() => {
  inserted = []
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('recordEventParticipation: the default event_year is the school year', () => {
  it('keeps the year that is ending up to the last moment of July', async () => {
    expect(await yearRecordedAt('2026-07-31T23:59:59Z')).toBe(2026)
  })

  it('moves to the next school year from the first of August', async () => {
    expect(await yearRecordedAt('2026-08-01T00:00:00Z')).toBe(2027)
  })

  it('files an autumn registration under the year it finishes in, not the calendar year', async () => {
    expect(await yearRecordedAt('2026-10-15T12:00:00Z')).toBe(2027)
  })

  it('does not roll over at New Year', async () => {
    expect(await yearRecordedAt('2026-12-31T23:59:59Z')).toBe(2027)
    expect(await yearRecordedAt('2027-01-01T00:00:00Z')).toBe(2027)
  })

  it('a year the caller gives wins over the default', async () => {
    expect(await yearRecordedAt('2026-10-15T12:00:00Z', 2026)).toBe(2026)
  })
})
