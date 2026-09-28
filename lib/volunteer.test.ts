import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dispatchAgreement } = vi.hoisted(() => ({
  dispatchAgreement: vi.fn(async (_db: unknown, _ctx: unknown) => 'issued' as const),
}))

vi.mock('@/lib/docusign-agreements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./docusign-agreements')>()
  return { ...actual, dispatchAgreement }
})
vi.mock('@/lib/member-roles', () => ({ addGlobalRole: vi.fn(), memberHasRole: vi.fn() }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: vi.fn() }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/compliance', () => ({
  deriveCompliance: () => ({ state: 'not_required', detail: null }),
  loadComplianceRecordsByEmails: async () => new Map(),
}))

import { dispatchVolunteerAgreement, pickVolunteerAgreement, getVolunteerStatuses } from './volunteer'

// Minimal chainable Supabase stub: records every .in() filter and returns `rows`.
function makeDb(rows: unknown[]) {
  const ins: Record<string, unknown[]> = {}
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: (col: string, vals: unknown[]) => { ins[col] = vals; return chain },
    limit: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  })
  return { db: { from: () => chain } as never, ins }
}

const MEMBER = {
  id: 'm1', first_name: 'Pat', last_name: 'Eaton', email: 'pat@example.org',
  phone: null, date_of_birth: null,
}

beforeEach(() => vi.clearAllMocks())

describe('dispatchVolunteerAgreement', () => {
  it('issues when nothing is in flight, recorded against the program', async () => {
    const { db } = makeDb([])
    expect(await dispatchVolunteerAgreement(db, MEMBER)).toBe('issued')
    const ctx = dispatchAgreement.mock.calls[0][1] as { eventSlug: string; eventRole: string; participantId: null }
    expect(ctx.eventSlug).toBe('volunteer-program')
    expect(ctx.eventRole).toBe('volunteer')
    expect(ctx.participantId).toBeNull()
  })

  it('treats an in-flight MENTOR envelope as in flight (same document)', async () => {
    const { db, ins } = makeDb([{ id: 'env-mentor' }])
    expect(await dispatchVolunteerAgreement(db, MEMBER)).toBe('in_flight')
    expect(ins.envelope_type).toEqual(['mentor', 'volunteer'])
    expect(dispatchAgreement).not.toHaveBeenCalled()
  })

  it('force bypasses the in-flight guard (admin re-issue)', async () => {
    const { db } = makeDb([{ id: 'env-open' }])
    expect(await dispatchVolunteerAgreement(db, MEMBER, { force: true })).toBe('issued')
  })

  it('does nothing without an email', async () => {
    const { db } = makeDb([])
    expect(await dispatchVolunteerAgreement(db, { ...MEMBER, email: null })).toBe('no_email')
    expect(dispatchAgreement).not.toHaveBeenCalled()
  })
})

describe('getVolunteerStatuses', () => {
  it('counts a signed mentor envelope as a signed Volunteer Agreement', async () => {
    const { db, ins } = makeDb([{ member_id: 'm1', status: 'completed', completed_at: new Date().toISOString() }])
    const out = await getVolunteerStatuses(db, [{ id: 'm1', email: 'pat@example.org', date_of_birth: null }])
    expect(ins.envelope_type).toEqual(['mentor', 'volunteer'])
    expect(out.m1.agreement).toBe('complete')
  })
})

describe('pickVolunteerAgreement', () => {
  const NOW = new Date('2026-09-28T00:00:00Z')
  const row = (id: string, status: string, completed_at: string | null, sent_at = '2026-01-01T00:00:00Z') => ({
    id, status, completed_at, sent_at, event_title: 'Stellr Volunteer Program',
    reused_from: null, signers_total: 2, signers_completed: 0,
  })

  it('returns null when nothing has been issued', () => {
    expect(pickVolunteerAgreement([], NOW)).toBeNull()
  })

  it('prefers an unexpired signed agreement over a newer in-flight or voided one', () => {
    const picked = pickVolunteerAgreement([
      row('voided', 'voided', null, '2026-09-01T00:00:00Z'),
      row('open', 'sent', null, '2026-08-01T00:00:00Z'),
      row('signed', 'completed', '2025-06-01T00:00:00Z'),
    ], NOW)
    expect(picked?.id).toBe('signed')
    expect(picked?.expires_at).toBe('2028-06-01T00:00:00.000Z')
  })

  it('falls back to in-flight, then to the newest dead envelope', () => {
    expect(pickVolunteerAgreement([
      row('declined', 'declined', null, '2026-09-01T00:00:00Z'),
      row('open', 'sent', null, '2026-08-01T00:00:00Z'),
    ], NOW)?.id).toBe('open')
    expect(pickVolunteerAgreement([
      row('expired', 'completed', '2022-01-01T00:00:00Z'),
      row('declined', 'declined', null, '2026-09-01T00:00:00Z'),
    ], NOW)?.id).toBe('declined')
  })
})
