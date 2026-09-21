import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BackgroundProvider } from '@/lib/background-provider'

const { logActivity } = vi.hoisted(() => ({
  logActivity: vi.fn(async (_input: unknown, _db?: unknown) => {}),
}))
vi.mock('@/lib/activity-log', () => ({ logActivity }))

import { applyCheckOutcome, syncStaleChecks } from './background-sync'

// A minimal chainable stand-in for the two supabase calls this module makes:
// update(...).eq(...) and select(...).eq().in().lt().order().limit().
function fakeDb(openRows: Record<string, unknown>[] = []) {
  const updates: { id: string; patch: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      if (col === 'id') updates[updates.length - 1].id = val as string
      return chain
    },
    in: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: openRows, error: null }),
    update: (patch: Record<string, unknown>) => {
      updates.push({ id: '', patch })
      return chain
    },
  }
  const db = { from: () => chain }
  return { db: db as never, updates }
}

const row = { id: 'row1', member_id: 'mem1', status: 'invited' }

beforeEach(() => logActivity.mockClear())

describe('applyCheckOutcome', () => {
  it('passed: stamps completed_at and a 3-year expires_at, logs once', async () => {
    const { db, updates } = fakeDb()
    const r = await applyCheckOutcome(db, row, { candidateRef: 'c', invitationRef: null, reportRef: 'rep', status: 'passed', result: 'clear' }, 'webhook')
    expect(r.changed).toBe(true)
    const patch = updates[0].patch
    expect(updates[0].id).toBe('row1')
    expect(patch).toMatchObject({ status: 'passed', result: 'clear', provider_report_ref: 'rep' })
    expect(patch.completed_at).toBeTruthy()
    const years = (new Date(patch.expires_at as string).getTime() - Date.now()) / (365.25 * 86400000)
    expect(years).toBeGreaterThan(2.99)
    expect(years).toBeLessThan(3.01)
    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ action: 'background_check_passed', metadata: { source: 'webhook' } })
  })

  it('referred / cancelled complete the report without an expiry; expired does not complete it', async () => {
    for (const status of ['referred', 'cancelled'] as const) {
      const { db, updates } = fakeDb()
      await applyCheckOutcome(db, row, { candidateRef: 'c', invitationRef: null, reportRef: null, status, result: null }, 'sync')
      expect(updates[0].patch.completed_at).toBeTruthy()
      expect(updates[0].patch.expires_at).toBeUndefined()
    }
    const { db, updates } = fakeDb()
    await applyCheckOutcome(db, row, { candidateRef: 'c', invitationRef: null, reportRef: null, status: 'expired', result: 'expired' }, 'sync')
    expect(updates[0].patch.completed_at).toBeUndefined()
    expect(logActivity.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      'background_check_referred',
      'background_check_cancelled',
      'background_check_expired',
    ])
  })

  it('in_progress writes assessment/includes_canceled when present and logs nothing', async () => {
    const { db, updates } = fakeDb()
    await applyCheckOutcome(db, row, { candidateRef: 'c', invitationRef: null, reportRef: 'rep', status: 'in_progress', result: null, assessment: 'review', includesCanceled: true }, 'webhook')
    expect(updates[0].patch).toMatchObject({ status: 'in_progress', assessment: 'review', includes_canceled: true })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('re-delivering the same terminal outcome rewrites the row but does not log again', async () => {
    const { db } = fakeDb()
    const r = await applyCheckOutcome(db, { ...row, status: 'passed' }, { candidateRef: 'c', invitationRef: null, reportRef: 'rep', status: 'passed', result: 'clear' }, 'webhook')
    expect(r.changed).toBe(false)
    expect(logActivity).not.toHaveBeenCalled()
  })
})

describe('syncStaleChecks', () => {
  function provider(fetchStatus: BackgroundProvider['fetchStatus']): BackgroundProvider {
    return {
      name: 'checkr',
      configured: () => true,
      order: async () => { throw new Error('not used') },
      verifyWebhook: () => true,
      parseWebhook: () => null,
      fetchStatus,
    }
  }
  const open = (id: string, refs: Partial<Record<'provider_candidate_ref' | 'provider_invitation_ref' | 'provider_report_ref', string>> = {}) => ({
    id, member_id: `m-${id}`, status: 'invited',
    provider_candidate_ref: null, provider_invitation_ref: null, provider_report_ref: null, ...refs,
  })

  it('applies outcomes, counts unchanged rows, and isolates per-row errors', async () => {
    const { db, updates } = fakeDb([open('a', { provider_report_ref: 'rep_a' }), open('b', { provider_invitation_ref: 'inv_b' }), open('c', { provider_invitation_ref: 'inv_c' })])
    const p = provider(async (refs) => {
      if (refs.reportRef === 'rep_a') return { candidateRef: null, invitationRef: null, reportRef: 'rep_a', status: 'passed', result: 'clear' }
      if (refs.invitationRef === 'inv_b') return null
      throw new Error('Checkr GET /invitations/inv_c failed: 500')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await syncStaleChecks(db, p)
    expect(result).toMatchObject({ scanned: 3, updated: 1, unchanged: 1 })
    expect(result.errors).toEqual([{ id: 'c', error: expect.stringMatching(/500/) }])
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 'a', patch: { status: 'passed' } })
  })

  it('a poll that returns the row\'s current status counts as unchanged', async () => {
    const { db } = fakeDb([{ ...open('a', { provider_report_ref: 'r' }), status: 'in_progress' }])
    const p = provider(async () => ({ candidateRef: null, invitationRef: null, reportRef: 'r', status: 'in_progress', result: null }))
    const result = await syncStaleChecks(db, p)
    expect(result).toMatchObject({ scanned: 1, updated: 0, unchanged: 1 })
    expect(logActivity).not.toHaveBeenCalled()
  })
})
