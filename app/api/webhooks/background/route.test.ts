import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review BG-6: the background webhook reconciles an incoming event to one of
// our rows. The old code matched on the Checkr candidate id alone, newest-row
// undefined — which breaks when two checks share a candidate (the 22-Sept flow:
// delete an invitation, re-order the same day, same candidate within Checkr's 24h
// window). A late invitation.deleted for the OLD invitation could then land on the
// NEWER row and cancel it, stranding a real outcome. These tests pin the new
// most-specific-ref-first matching.

const { state } = vi.hoisted(() => ({
  state: {
    rows: [] as Record<string, unknown>[],
    parsed: null as Record<string, unknown> | null,
    applied: [] as string[], // ids passed to applyCheckOutcome, in order
  },
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => 'sig' }) }))
vi.mock('@/lib/background-provider', () => ({
  getBackgroundProvider: () => ({
    verifyWebhook: () => true,
    parseWebhook: () => state.parsed,
  }),
}))
vi.mock('@/lib/background-sync', () => ({
  applyCheckOutcome: vi.fn(async (_db: unknown, row: { id: string }) => {
    state.applied.push(row.id)
    return { changed: true }
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    // A tiny stand-in for member_background_checks: records .eq()/.in() filters
    // and returns the newest matching row (emulating .order(ordered_at, desc)).
    from: () => {
      const eqs: Record<string, unknown> = {}
      const ins: Record<string, unknown[]> = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (col: string, val: unknown) => { eqs[col] = val; return chain },
        in: (col: string, vals: unknown[]) => { ins[col] = vals; return chain },
        maybeSingle: async () => {
          const matching = state.rows
            .filter((r) => Object.entries(eqs).every(([c, v]) => r[c] === v))
            .filter((r) => Object.entries(ins).every(([c, vs]) => vs.includes(r[c] as never)))
            .sort((a, b) => String(b.ordered_at ?? '').localeCompare(String(a.ordered_at ?? '')))
          return { data: matching[0] ?? null, error: null }
        },
      }
      return chain
    },
  }),
}))

const { POST } = await import('./route')
const call = () => POST(new Request('https://app.test/api/webhooks/background', { method: 'POST', body: '{}' }))

// Two checks sharing one Checkr candidate: an older, re-ordered-away invitation
// and the current one.
const OLD = { id: 'old', member_id: 'm1', status: 'cancelled', ordered_at: '2026-09-01T00:00:00Z', provider_candidate_ref: 'cand1', provider_invitation_ref: 'inv_old', provider_report_ref: 'rep_old' }
const NEW = { id: 'new', member_id: 'm1', status: 'in_progress', ordered_at: '2026-09-22T00:00:00Z', provider_candidate_ref: 'cand1', provider_invitation_ref: 'inv_new', provider_report_ref: null }

beforeEach(() => {
  state.rows = [OLD, NEW]
  state.parsed = null
  state.applied = []
})

describe('POST /api/webhooks/background — row matching (BG-6)', () => {
  it('a stale invitation.deleted updates ONLY its own row, not the newer check sharing the candidate', async () => {
    state.parsed = { candidateRef: 'cand1', invitationRef: 'inv_old', reportRef: null, status: 'cancelled', result: 'canceled' }
    await call()
    expect(state.applied).toEqual(['old'])
  })

  it('a report event matches the row carrying that report ref, even when it is not the newest', async () => {
    state.parsed = { candidateRef: 'cand1', invitationRef: null, reportRef: 'rep_old', status: 'passed', result: 'clear' }
    await call()
    expect(state.applied).toEqual(['old'])
  })

  it('a report event whose id we have not stored yet falls back to the newest OPEN row for the candidate', async () => {
    state.parsed = { candidateRef: 'cand1', invitationRef: null, reportRef: 'rep_brand_new', status: 'passed', result: 'clear' }
    await call()
    expect(state.applied).toEqual(['new'])
  })
})
