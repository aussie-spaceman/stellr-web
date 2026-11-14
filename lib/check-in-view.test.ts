// @vitest-environment node
//
// A participant's check-in page shows no survey for another tenant's event while its survey
// is held (owner decision, 13 Nov 2026; lib/survey/hold.ts): the link would answer as
// nobody's. Decided from the distribution row in hand, so nothing more is read. Stellr's
// events, a NULL tenant included, show the survey exactly as before.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, type ChainCall } from '@/test/helpers/fake-chain-db'

const h = vi.hoisted(() => ({
  distribution: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown> | null> => null),
  status: vi.fn((..._a: unknown[]) => 'open'),
}))

vi.mock('@/lib/survey/distributions', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  distributionForEvent: h.distribution,
  statusNow: h.status,
}))
vi.mock('@/lib/survey/tokens', () => ({
  surveyToken: (id: string, v: number) => `tok-${id}-${v}`,
  surveyLink: (t: string) => `https://app.example.test/survey/${t}`,
}))

const { loadCheckInView } = await import('./check-in-view')

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const SLUG = 'colorado-space-design-challenge'

function db(invitation: Record<string, unknown> | null) {
  return fakeChainDb((call: ChainCall) => {
    if (call.table === 'participants') {
      return { data: { id: 'p1', first_name: 'Alex', last_name: 'Doe', t_shirt_size: 'M', checked_in_at: null, event_companies: { number: 4 } }, error: null }
    }
    if (call.table === 'event_settings') return { data: { resources_url: 'https://docs.example.test/folder' }, error: null }
    if (call.table === 'survey_invitations') return { data: invitation, error: null }
    return { data: null, error: null }
  })
}

const distribution = (tenant_id: string | null) => ({
  id: 'd1', event_slug: SLUG, tenant_id, opens_at: '2026-11-01T00:00:00Z', event_time_zone: 'America/Denver',
})

beforeEach(() => {
  h.distribution.mockReset()
  h.status.mockReset().mockReturnValue('open')
})

describe('the check-in page survey', () => {
  it("Stellr's, a NULL tenant included, shows the participant's own survey link", async () => {
    for (const tenant of [STELLR, null]) {
      h.distribution.mockResolvedValue(distribution(tenant))
      const fake = db({ id: 'inv1', token_version: 2, send_via: 'participant', status: 'queued' })
      const view = await loadCheckInView(fake.db as unknown as SupabaseClient, SLUG, 'p1')
      expect(view?.survey, String(tenant)).toEqual({ state: 'open', url: 'https://app.example.test/survey/tok-inv1-2' })
      expect(fake.calls.map((c) => c.table), String(tenant)).toContain('survey_invitations')
    }
  })

  it("Stellr's late registrant with no invitation is sent to the event survey page", async () => {
    h.distribution.mockResolvedValue(distribution(null))
    const fake = db(null)
    const view = await loadCheckInView(fake.db as unknown as SupabaseClient, SLUG, 'p1')
    expect(view?.survey).toEqual({ state: 'open', url: `/survey/event/${SLUG}` })
  })

  it("another tenant's shows no survey in any state, and reads no invitation", async () => {
    for (const status of ['open', 'scheduled', 'closed']) {
      h.distribution.mockResolvedValue(distribution(CANARY))
      h.status.mockReturnValue(status)
      const fake = db({ id: 'inv1', token_version: 2, send_via: 'participant', status: 'queued' })
      const view = await loadCheckInView(fake.db as unknown as SupabaseClient, SLUG, 'p1')
      expect(view?.survey, status).toBeNull()
      // Everything else on the page is unchanged.
      expect(view?.resourcesUrl).toBe('https://docs.example.test/folder')
      expect(view?.companyNumber).toBe(4)
      expect(fake.calls.map((c) => c.table)).not.toContain('survey_invitations')
    }
    expect(h.status).not.toHaveBeenCalled()
  })

  it('shows no survey for a distribution read without its tenant, rather than guessing', async () => {
    h.distribution.mockResolvedValue({ ...distribution(null), tenant_id: undefined })
    const fake = db({ id: 'inv1', token_version: 2, send_via: 'participant', status: 'queued' })
    const view = await loadCheckInView(fake.db as unknown as SupabaseClient, SLUG, 'p1')
    // distributionTenant throws on a missing column; the page already treats a survey error as no survey.
    expect(view?.survey).toBeNull()
    expect(fake.calls.map((c) => c.table)).not.toContain('survey_invitations')
  })
})
