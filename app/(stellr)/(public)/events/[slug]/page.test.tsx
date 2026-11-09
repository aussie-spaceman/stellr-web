// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// deep review PUB-9: a Sanity fetch error was swallowed to null and rendered as
// notFound() — i.e. an outage/timeout became a 404, de-indexing a live event
// URL. The fix distinguishes "no such event" (null → notFound) from "fetch
// failed" (throw → the error boundary / a retryable 500).

const { getEventBySlug } = vi.hoisted(() => ({ getEventBySlug: vi.fn() }))
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug,
  urlFor: () => ({ width: () => ({ height: () => ({ url: () => '' }) }) }),
}))
vi.mock('@/lib/schema-series', () => ({ getSeriesMembers: async () => [] }))
vi.mock('@/lib/campaign-registrations', () => ({
  getMemberCampaignContext: async () => ({ membership: null, registeredSlugs: new Set() }),
}))
vi.mock('@/lib/event-pricing', () => ({
  getEventPrice: async () => ({ kind: 'unavailable' }),
  eventPriceLabel: () => null,
}))
// Component + rich-text modules — never rendered in these branches, mocked only
// so the page module imports cleanly in a node test.
vi.mock('next-sanity', () => ({ PortableText: () => null }))
vi.mock('@/components/campaigns/CampaignDetail', () => ({ CampaignDetail: () => null }))
vi.mock('@/components/sections/EventCtas', () => ({ EventHeroCtas: () => null, EventNotifyButton: () => null }))
vi.mock('@/components/sections/EventFlyers', () => ({ EventFlyers: () => null }))
vi.mock('@/components/ui/CardPills', () => ({ CardPills: () => null }))
vi.mock('@/components/analytics/TrackEvent', () => ({ TrackEvent: () => null }))
vi.mock('@/components/ui/MissionFundingNote', () => ({ MissionFundingNote: () => null }))

const Page = (await import('./page')).default

const render = () => Page({ params: Promise.resolve({ slug: 'nevada-2027' }) })

beforeEach(() => vi.clearAllMocks())

describe('event detail page — Sanity error vs not-found (PUB-9)', () => {
  it('re-throws a Sanity fetch error instead of 404ing', async () => {
    getEventBySlug.mockRejectedValueOnce(new Error('sanity 503'))
    await expect(render()).rejects.toThrow('sanity 503')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('still 404s a genuinely missing event (null)', async () => {
    getEventBySlug.mockResolvedValueOnce(null)
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
