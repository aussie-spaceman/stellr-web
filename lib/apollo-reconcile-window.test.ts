import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The reconciliation window.
 *
 * `reconcileProspects` used to take `prospects.slice(0, limit)` — the same first
 * 200 every run — so past 200 engaged contacts anyone beyond that index was
 * never reconciled and nothing said so. These pin the replacement: the window
 * rotates, wraps, and reports that it is partial.
 *
 * HubSpot is stubbed out entirely; what is under test is which prospects the
 * window selects, not what happens to them.
 */

vi.mock('@/lib/hubspot', () => ({
  getContactByEmail: vi.fn().mockResolvedValue({ id: 'c1', properties: {} }),
  upsertContact: vi.fn().mockResolvedValue({ ok: true, id: 'c1' }),
  createDeal: vi.fn().mockResolvedValue({ ok: true, id: 'd1' }),
  updateDeal: vi.fn().mockResolvedValue({ ok: true }),
  dealsForContact: vi.fn().mockResolvedValue([]),
  associateDefault: vi.fn().mockResolvedValue(undefined),
  ensureCompany: vi.fn().mockResolvedValue(null),
  createNote: vi.fn().mockResolvedValue({ ok: true }),
}))

const { reconcileProspects } = await import('./apollo-reconcile')

function prospects(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    email: `p${i}@example.com`,
    firstName: `P${i}`,
    lastName: 'Test',
    engagement: 'replied' as const,
  }))
}

/** Dry-run keeps it fast and side-effect free; windowing is identical. */
const run = (list: ReturnType<typeof prospects>, limit?: number, offset?: number) =>
  reconcileProspects(list, { apply: false, limit, offset, paceMs: 0 })

beforeEach(() => vi.clearAllMocks())

describe('when everything fits', () => {
  it('considers all of them and reports not truncated', async () => {
    const r = await run(prospects(48), 200)
    expect(r.considered).toBe(48)
    expect(r.total).toBe(48)
    expect(r.truncated).toBe(false)
    expect(r.windowOffset).toBe(0)
  })

  it('ignores the offset entirely — no needless rotation', async () => {
    const r = await run(prospects(48), 200, 12_345)
    expect(r.windowOffset).toBe(0)
    expect(r.considered).toBe(48)
  })
})

describe('when there are more prospects than the limit', () => {
  it('reports truncation rather than staying silent', async () => {
    const r = await run(prospects(250), 200)
    expect(r.truncated).toBe(true)
    expect(r.total).toBe(250)
    expect(r.considered).toBe(200)
  })

  it('starts at the offset instead of always at zero', async () => {
    const r = await run(prospects(250), 200, 200)
    expect(r.windowOffset).toBe(200)
    // The regression: this used to be p0.
    expect(r.changes[0]?.email).toBe('p200@example.com')
  })

  it('wraps past the end so the window is always full', async () => {
    const r = await run(prospects(250), 200, 200)
    expect(r.considered).toBe(200)
    const seen = r.changes.map((c) => c.email)
    expect(seen).toContain('p249@example.com') // last
    expect(seen).toContain('p0@example.com') // wrapped
  })

  it('covers every prospect across ceil(total / limit) runs', async () => {
    const list = prospects(250)
    const seen = new Set<string>()
    for (let day = 0; day < Math.ceil(250 / 200); day++) {
      const r = await run(list, 200, day * 200)
      r.changes.forEach((c) => seen.add(c.email))
    }
    // The property that actually matters: nobody is stranded.
    expect(seen.size).toBe(250)
  })

  it('normalises an offset larger than the list', async () => {
    // The day-derived offset grows without bound, so it must wrap safely.
    const r = await run(prospects(250), 200, 20_250)
    expect(r.windowOffset).toBe(20_250 % 250)
    expect(r.considered).toBe(200)
  })

  it('normalises a negative offset rather than throwing', async () => {
    const r = await run(prospects(250), 200, -1)
    expect(r.windowOffset).toBe(249)
    expect(r.considered).toBe(200)
  })
})
