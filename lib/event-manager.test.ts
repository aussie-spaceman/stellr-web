// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { deriveCompliance } from '@/lib/compliance'

// Event Manager rules (lib/event-manager.ts): who may hold it, how long, and the
// daily sweep. Synthetic people only (the repo is public).

const sendEmail = vi.fn(async () => ({ id: 'e1' }))
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: vi.fn() }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async (slug: string) => ({ title: slug, date: '2026-12-05' }) }))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({ users: {} }) }))

const {
  decideEligibility,
  defaultExpiryDate,
  validateExpiryDate,
  sweepEventManagers,
  activeAssignmentFilter,
  isAssignmentActive,
  expiryDateToTimestamp,
} = await import('./event-manager')

const NOW = new Date('2026-11-09T12:00:00Z')
const ADULT = { is_active: true, clerk_user_id: 'user_a', date_of_birth: '1985-03-02' }
const PASSED = {
  id: 'bc1', status: 'passed' as const, result: null, assessment: null, includes_canceled: false, provider_report_ref: 'r',
  adjudicated_at: null, adjudication_outcome: null, adjudicated_label: null, adjudication_notes: null, provider_adjudication: null,
  ordered_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-05T00:00:00Z', expires_at: '2029-01-05T00:00:00Z', report_pdf_url: null,
}
const summary = (checks = [PASSED], dob = ADULT.date_of_birth) => deriveCompliance(null, checks, 'mentor', dob, undefined, null)

describe('decideEligibility', () => {
  it('passes a cleared adult with a login, and says until when', () => {
    expect(decideEligibility(ADULT, summary(), NOW)).toEqual({ ok: true, basis: 'background_check', clearanceUntil: '2029-01-05', detail: expect.any(String) })
  })

  it.each([
    ['no login', { ...ADULT, clerk_user_id: null }, 'no_login'],
    ['deactivated', { ...ADULT, is_active: false }, 'inactive'],
    ['no date of birth', { ...ADULT, date_of_birth: null }, 'no_dob'],
    ['a minor', { ...ADULT, date_of_birth: '2011-01-01' }, 'minor'],
  ])('refuses %s', (_n, member, code) => {
    expect(decideEligibility(member, summary(), NOW)).toMatchObject({ ok: false, code })
  })

  it('refuses an adult with nothing on file', () => {
    expect(decideEligibility(ADULT, summary([]), NOW)).toMatchObject({ ok: false, code: 'not_cleared' })
  })

  it('refuses an expired check', () => {
    expect(decideEligibility(ADULT, summary([{ ...PASSED, expires_at: '2026-10-01T00:00:00Z' }]), NOW)).toMatchObject({ ok: false, code: 'not_cleared' })
  })

  it('refuses a missing member', () => {
    expect(decideEligibility(null, null, NOW)).toMatchObject({ ok: false, code: 'no_member' })
  })
})

describe('expiry dates', () => {
  it('defaults to the last day + 30', () => {
    expect(defaultExpiryDate({ date: '2026-12-05', endDate: '2026-12-06' }, NOW)).toBe('2027-01-05')
    expect(defaultExpiryDate({ date: '2026-12-05' }, NOW)).toBe('2027-01-04')
  })

  it('counts an undated event (a campaign) from today', () => {
    expect(defaultExpiryDate({}, NOW)).toBe('2026-12-09')
  })

  it('stores the end of the expiry day, so access runs through it', () => {
    expect(expiryDateToTimestamp('2027-01-05')).toBe('2027-01-05T23:59:59.999Z')
  })

  const rules = { eventLast: '2026-12-06', clearanceUntil: '2029-01-05', now: NOW }
  it('accepts a date in range', () => expect(validateExpiryDate('2027-02-01', rules)).toBeNull())
  it('refuses the past', () => expect(validateExpiryDate('2026-11-01', rules)).toMatch(/past/))
  it('refuses more than a year after the event', () => expect(validateExpiryDate('2027-12-07', rules)).toMatch(/at most a year/))
  it('refuses a date past the clearance', () => {
    expect(validateExpiryDate('2027-03-01', { ...rules, clearanceUntil: '2027-02-01' })).toMatch(/clearance runs out/)
  })
  it('refuses nonsense', () => expect(validateExpiryDate('soon', rules)).toMatch(/must be a date/))
})

describe('active rows', () => {
  it('a row with no expiry, or a future one, is in force', () => {
    expect(isAssignmentActive({ expires_at: null }, NOW)).toBe(true)
    expect(isAssignmentActive({ expires_at: '2026-11-10T00:00:00Z' }, NOW)).toBe(true)
    expect(isAssignmentActive({ expires_at: '2026-11-09T11:59:59Z' }, NOW)).toBe(false)
  })

  it('the PostgREST filter says the same', () => {
    expect(activeAssignmentFilter(NOW)).toBe('expires_at.is.null,expires_at.gt.2026-11-09T12:00:00.000Z')
  })
})

describe('sweepEventManagers', () => {
  let db: FakeDb
  const users = {
    getUser: vi.fn(async () => ({ publicMetadata: { role: 'event_manager' } })),
    updateUserMetadata: vi.fn(async () => undefined),
  }
  const member = (id: string, clerk: string, checks: unknown[]) => ({
    id, clerk_user_id: clerk, first_name: 'Sam', email: `${id}@example.test`, is_active: true, date_of_birth: '1980-01-01',
    member_teacher_licenses: [], member_background_checks: checks, member_external_background_checks: [],
  })

  beforeEach(() => {
    sendEmail.mockClear()
    users.updateUserMetadata.mockClear()
    db = fakeSupabase({
      members: [member('m-ok', 'u-ok', [PASSED]), member('m-lapsed', 'u-lapsed', [{ ...PASSED, expires_at: '2026-10-01T00:00:00Z' }])],
      event_manager_assignments: [
        { id: 'a1', clerk_user_id: 'u-ok', event_slug: 'ev-1', member_id: 'm-ok', clearance_basis: 'background_check', expires_at: '2027-01-05T23:59:59.999Z' },
        { id: 'a2', clerk_user_id: 'u-ok', event_slug: 'ev-old', member_id: 'm-ok', clearance_basis: 'background_check', expires_at: '2026-11-01T23:59:59.999Z' },
        { id: 'a3', clerk_user_id: 'u-lapsed', event_slug: 'ev-1', member_id: 'm-lapsed', clearance_basis: 'background_check', expires_at: '2027-01-05T23:59:59.999Z' },
        { id: 'a4', clerk_user_id: 'u-legacy', event_slug: 'ev-1', member_id: null, clearance_basis: null, expires_at: null },
      ],
    })
  })

  it('removes expired rows and lapsed clearance, keeps the rest, and counts the ungated', async () => {
    const r = await sweepEventManagers(db.client, { now: NOW, users })
    expect(r).toEqual({ expired: 1, clearanceLapsed: 1, ungated: 1, errors: [] })
    expect(db.table('event_manager_assignments').map((a) => a.id).sort()).toEqual(['a1', 'a4'])
  })

  it('clears the Clerk role only for someone left with nothing, and emails each removal', async () => {
    await sweepEventManagers(db.client, { now: NOW, users })
    expect(users.updateUserMetadata).toHaveBeenCalledTimes(1)
    expect(users.updateUserMetadata).toHaveBeenCalledWith('u-lapsed', { publicMetadata: { role: null } })
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
