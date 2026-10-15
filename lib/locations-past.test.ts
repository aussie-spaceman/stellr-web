import { describe, expect, it, vi, afterEach } from 'vitest'

// The map's "running now" pins: an event that has already run must not get one,
// whatever its CMS flags say.
const fetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sanity', () => ({ client: { fetch } }))

const { getMapLocations } = await import('./locations')

afterEach(() => {
  vi.useRealTimers()
  fetch.mockReset()
})

describe('getMapLocations', () => {
  it('drops a live event whose last day has passed and keeps upcoming ones', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T18:00:00Z'))
    fetch
      .mockResolvedValueOnce([
        { slug: { current: 'past' }, city: 'Golden', state: 'CO', date: '2026-10-03', type: 'space' },
        { slug: { current: 'today' }, city: 'Reno', state: 'NV', date: '2026-10-13', endDate: '2026-10-14', type: 'space' },
        { slug: { current: 'later' }, city: 'Mankato', state: 'MN', date: '2026-11-24', type: 'environmental' },
      ])
      .mockResolvedValueOnce([])
    const ids = (await getMapLocations()).map((l) => l.id)
    expect(ids).toEqual(['today', 'later'])
  })
})
