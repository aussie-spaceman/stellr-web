import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

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

  // This used to ignore the offset when everyone fitted. A run cut short by the
  // deadline (below) must resume where it stopped, so the offset always applies;
  // a run that finishes still covers everyone, only starting further along.
  it('starts at the resume offset and still covers everyone', async () => {
    const r = await run(prospects(48), 200, 12_345)
    expect(r.windowOffset).toBe(12_345 % 48)
    expect(r.considered).toBe(48)
    expect(r.changes[0]?.email).toBe(`p${12_345 % 48}@example.com`)
    expect(new Set(r.changes.map((c) => c.email)).size).toBe(48)
    expect(r.nextOffset).toBe(12_345 % 48) // a full lap ends where it began
  })
})

describe('when the deadline cuts a run short', () => {
  // Every run from 13 to 21 Oct 2026 outlived the cron's 60 s and was killed
  // part-way, so none finished and the same first prospects were re-checked
  // daily. These pin the deadline: stop cleanly, report it, say where to resume.
  afterEach(() => vi.restoreAllMocks())

  /** A clock that advances 1 s every time it is read. */
  function tickingClock() {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000))
  }

  const runUntil = (list: ReturnType<typeof prospects>, offset: number, deadline: number) =>
    reconcileProspects(list, { apply: false, limit: 200, offset, deadline, paceMs: 0 })

  it('stops starting prospects at the deadline and says where to resume', async () => {
    tickingClock()
    // Reads at 1 s … 5 s pass; the read at 6 s is past 5.5 s and stops the run.
    const r = await runUntil(prospects(110), 40, 5_500)
    expect(r.stoppedEarly).toBe(true)
    expect(r.considered).toBe(5)
    expect(r.changes.map((c) => c.email)).toEqual(['p40', 'p41', 'p42', 'p43', 'p44'].map((p) => `${p}@example.com`))
    expect(r.nextOffset).toBe(45)
  })

  it('does nothing past an already-passed deadline, and keeps the cursor', async () => {
    const r = await runUntil(prospects(110), 70, 0)
    expect(r.stoppedEarly).toBe(true)
    expect(r.considered).toBe(0)
    expect(r.nextOffset).toBe(70)
  })

  it('reaches every prospect across runs by chaining nextOffset', async () => {
    tickingClock()
    const list = prospects(110)
    const seen = new Set<string>()
    let offset = 0
    for (let day = 0; day < 4; day++) {
      // ~30 prospects per run, as at the real cron's pace.
      const r = await runUntil(list, offset, Date.now() + 30_500)
      r.changes.forEach((c) => seen.add(c.email))
      offset = r.nextOffset
    }
    expect(seen.size).toBe(110)
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
