// @vitest-environment node
//
// Tracker event-check-in-v2.7: what the participant's check-in page says about the
// event survey, in every state the distribution can be in (lib/check-in-view.ts,
// surveyStateFor). Only "scheduled" had ever been seen rendered. The status comes
// from the real statusNow (lib/survey/schedule.ts effectiveStatus) on a fixed
// clock, so the transitions between scheduled, open and closed are the app's own;
// only the distribution read and the token signer are stood in. The other
// tenant's case is check-in-view.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'

const h = vi.hoisted(() => ({
  distribution: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown> | null> => null),
}))

vi.mock('@/lib/survey/distributions', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  distributionForEvent: h.distribution,
}))
vi.mock('@/lib/survey/tokens', () => ({
  surveyToken: (id: string, v: number) => `tok-${id}-${v}`,
  surveyLink: (t: string) => `https://app.example.test/survey/${t}`,
}))

const { loadCheckInView } = await import('./check-in-view')

const SLUG = 'seed-regional-challenge'
const NOW = new Date('2026-11-14T18:00:00Z')
const PAST = '2026-11-10T00:00:00Z'
const FUTURE = '2026-11-30T00:00:00Z'

type Invitation = { id: string; token_version: number; send_via: string; status: string }

function db(invitation: Invitation | null) {
  return fakeChainDb((call: ChainCall) => {
    if (call.table === 'participants') {
      return { data: { id: 'p1', first_name: 'Alex', last_name: 'Doe', t_shirt_size: 'M', checked_in_at: null, event_companies: { number: 4 } }, error: null }
    }
    if (call.table === 'event_settings') return { data: { resources_url: null }, error: null }
    if (call.table === 'survey_invitations') return { data: invitation, error: null }
    return { data: null, error: null }
  })
}

/** A Stellr distribution (NULL tenant) in the given schedule state. */
const distribution = (status: string, opens_at: string, closes_at: string) => ({
  id: 'd1',
  event_slug: SLUG,
  tenant_id: null,
  status,
  opens_at,
  closes_at,
  event_time_zone: 'America/Denver',
})

async function surveyFor(d: Record<string, unknown> | null, invitation: Invitation | null = null) {
  h.distribution.mockResolvedValue(d)
  const fake = db(invitation)
  const view = await loadCheckInView(fake.db as unknown as SupabaseClient, SLUG, 'p1')
  return { survey: view?.survey, view, read: fake.calls.map((c) => c.table), calls: fake.calls }
}

const invitation = (over: Partial<Invitation> = {}): Invitation => ({ id: 'inv1', token_version: 3, send_via: 'participant', status: 'sent', ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  h.distribution.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the check-in page survey, by distribution state', () => {
  it('says nothing when the event has no survey', async () => {
    const { survey, view, read } = await surveyFor(null)
    expect(survey).toBeNull()
    expect(view?.firstName).toBe('Alex')
    expect(read).not.toContain('survey_invitations')
  })

  it('scheduled: the go-live day, in the event’s own time zone, and no invitation read', async () => {
    // 05:00 UTC on the 17th is still the evening of the 16th in Denver.
    const { survey, read } = await surveyFor(distribution('scheduled', '2026-11-17T05:00:00Z', FUTURE), invitation())
    expect(survey).toEqual({ state: 'scheduled', opensOn: 'Monday, November 16' })
    expect(read).not.toContain('survey_invitations')
  })

  it('scheduled whose go-live has passed counts as open: the participant’s own link', async () => {
    const { survey } = await surveyFor(distribution('scheduled', PAST, FUTURE), invitation())
    expect(survey).toEqual({ state: 'open', url: 'https://app.example.test/survey/tok-inv1-3' })
  })

  it('open: the link is signed with the invitation’s current token version', async () => {
    const { survey, calls } = await surveyFor(distribution('open', PAST, FUTURE), invitation({ token_version: 7 }))
    expect(survey).toEqual({ state: 'open', url: 'https://app.example.test/survey/tok-inv1-7' })
    // This participant's invitation on this distribution, nobody else's.
    const read = calls.find((c) => c.table === 'survey_invitations')!
    expect(read.filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['distribution_id', 'd1'] },
        { method: 'eq', args: ['participant_id', 'p1'] },
      ]),
    )
  })

  it('open with no invitation yet (a late registrant): the event survey page, which emails one', async () => {
    const { survey } = await surveyFor(distribution('open', PAST, FUTURE), null)
    expect(survey).toEqual({ state: 'open', url: `/survey/event/${SLUG}` })
  })

  it('open for a minor: their parent or guardian is asked, never the student', async () => {
    const { survey } = await surveyFor(distribution('open', PAST, FUTURE), invitation({ send_via: 'guardian' }))
    expect(survey).toEqual({ state: 'guardian' })
  })

  it('submitted: thanks, and no link, whoever was asked', async () => {
    for (const send_via of ['participant', 'guardian']) {
      const { survey } = await surveyFor(distribution('open', PAST, FUTURE), invitation({ status: 'submitted', send_via }))
      expect(survey, send_via).toEqual({ state: 'submitted' })
    }
  })

  it('closed: by an admin, by its closing date passing while open, or before it ever opened', async () => {
    for (const d of [
      distribution('closed', PAST, FUTURE),
      distribution('open', PAST, '2026-11-14T17:59:59Z'),
      distribution('scheduled', PAST, '2026-11-12T00:00:00Z'),
    ]) {
      const { survey, read } = await surveyFor(d, invitation())
      expect(survey, String(d.status)).toEqual({ state: 'closed' })
      expect(read, String(d.status)).not.toContain('survey_invitations')
    }
  })

  it('paused: says nothing rather than a go-live date that has passed', async () => {
    for (const opens of [PAST, FUTURE]) {
      const { survey, read } = await surveyFor(distribution('paused', opens, FUTURE), invitation())
      expect(survey, opens).toBeNull()
      expect(read).not.toContain('survey_invitations')
    }
  })

  it('a failed survey read leaves the rest of the page as it was', async () => {
    h.distribution.mockRejectedValue(new Error('database unavailable'))
    const fake = db(invitation())
    const view = await loadCheckInView(fake.db as unknown as SupabaseClient, SLUG, 'p1')
    expect(view?.survey).toBeNull()
    expect(view).toMatchObject({ participantId: 'p1', firstName: 'Alex', companyNumber: 4, shirtSize: 'M' })
  })
})
