import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// deep review INT-7 + INT-8: the reconciler must not create a duplicate deal
// when the existing-deals read failed, and must not loop forever on a sustained
// Apollo 429.

const createDeal = vi.fn().mockResolvedValue({ ok: true, id: 'd1' })
const dealsForContact = vi.fn()

vi.mock('@/lib/hubspot', () => ({
  getContactByEmail: vi.fn().mockResolvedValue({ id: 'c1', properties: {} }),
  upsertContact: vi.fn().mockResolvedValue({ ok: true, id: 'c1' }),
  createNote: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/hubspot-deals', () => ({
  createDeal,
  dealsForContact,
  moveDealToStage: vi.fn().mockResolvedValue({ ok: true }),
  decideDealAction: (eng: string) => ({ action: 'create', stage: 's' }),
  STAGE_FOR: { clicked: 'si', replied: 'se' },
}))
vi.mock('@/lib/hubspot-companies', () => ({
  ensureCompany: vi.fn().mockResolvedValue(null),
  associateDefault: vi.fn().mockResolvedValue(undefined),
}))

const { reconcileProspects, fetchEngagedProspects } = await import('./apollo-reconcile')

beforeEach(() => vi.clearAllMocks())

describe('INT-7: a failed existing-deals read never creates a deal', () => {
  it('skips and counts failed when dealsForContact returns null', async () => {
    dealsForContact.mockResolvedValueOnce(null)
    const r = await reconcileProspects(
      [{ email: 'p@example.com', engagement: 'replied' as const }],
      { apply: true, paceMs: 0 },
    )
    expect(createDeal).not.toHaveBeenCalled()
    expect(r.failed).toBe(1)
    expect(r.created).toBe(0)
  })

  it('still creates a deal when the read succeeds with no deals ([])', async () => {
    dealsForContact.mockResolvedValueOnce([])
    const r = await reconcileProspects(
      [{ email: 'p@example.com', engagement: 'replied' as const }],
      { apply: true, paceMs: 0 },
    )
    expect(createDeal).toHaveBeenCalledTimes(1)
    expect(r.created).toBe(1)
  })
})

describe('INT-8: a sustained Apollo 429 fails after bounded retries, not forever', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects after 3 attempts instead of recursing until the function is killed', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => ({ status: 429, ok: false, headers: { get: () => null } }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const p = fetchEngagedProspects('apollo-key')
    const assertion = expect(p).rejects.toThrow(/rate-limited/i)
    await vi.runAllTimersAsync()
    await assertion
    // original + two retries on the first Apollo page, then it gives up.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })
})
