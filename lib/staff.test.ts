import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

const sendEmail = vi.fn(async (..._a: unknown[]) => ({}))
const audit = vi.fn(async (..._a: unknown[]) => ({ ok: false, skipped: 'disabled' }))
const issueStaffAgreement = vi.fn(async (..._a: unknown[]) => ({ agreementId: 'agr-1' }))
const documentReady = vi.fn(async () => true)
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn() }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: vi.fn() }))
vi.mock('@/lib/audit/platform', () => ({ audit: (...a: unknown[]) => audit(...a) }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => null }))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({ users: {}, sessions: {} }) }))
vi.mock('@/lib/esign/staff-agreement', () => ({
  STAFF_AGREEMENT_ENVELOPE_TYPE: 'staff',
  issueStaffAgreement: (...a: unknown[]) => issueStaffAgreement(...a),
  staffAgreementDocumentReady: () => documentReady(),
}))

const {
  decideStaffEligibility,
  staffExpiry,
  nextState,
  reminderDue,
  reconcileStaffGrant,
  revokeStaff,
  grantStaff,
  clearStaffRole,
  setStaffRole,
  loadTrainingCompletion,
} = await import('./staff')
type StaffFacts = import('./staff').StaffFacts
type StaffClerk = import('./staff').StaffClerk

const NOW = new Date('2026-11-13T12:00:00Z')
const MEMBER = 'm-1'
const CLERK = 'user_1'

const cleared = { ok: true as const, basis: 'background_check' as const, clearanceUntil: '2028-06-30', detail: 'Background check passed' }
const allMet = (over: Partial<StaffFacts> = {}): StaffFacts => ({
  eligibility: cleared,
  agreementCompletedAt: '2026-11-01T00:00:00Z',
  agreementVersion: 'staff-1',
  agreementInFlight: false,
  training: '2026-11-02T00:00:00Z',
  mfa: true,
  ...over,
})

describe('decideStaffEligibility', () => {
  it('is ok only when all five prerequisites hold, and runs no later than the earliest of them', () => {
    const d = decideStaffEligibility(allMet(), NOW)
    expect(d.ok).toBe(true)
    expect(d.missing).toEqual([])
    expect(d.until).toBe('2028-06-30') // clearance ends before the agreement and training (2029)
  })
  it.each([
    ['no MFA', { mfa: false }, ['mfa']],
    ['MFA unreadable', { mfa: null }, ['mfa']],
    ['no agreement', { agreementCompletedAt: null, agreementVersion: null }, ['agreement']],
    ['agreement lapsed (over 3 years)', { agreementCompletedAt: '2023-11-01T00:00:00Z' }, ['agreement']],
    ['training not done', { training: null }, ['training']],
    ['training lapsed', { training: '2023-01-01T00:00:00Z' }, ['training']],
    ['no training module chosen', { training: 'not_configured' as const }, ['training']],
    ['awaiting verification', { eligibility: { ok: false as const, code: 'awaiting_verification' as const, message: 'x' } }, ['clearance']],
    ['not cleared', { eligibility: { ok: false as const, code: 'not_cleared' as const, message: 'x' } }, ['clearance']],
    ['a minor', { eligibility: { ok: false as const, code: 'minor' as const, message: 'x' } }, ['member', 'clearance']],
    ['no login', { eligibility: { ok: false as const, code: 'no_login' as const, message: 'x' } }, ['member', 'clearance']],
  ])('%s blocks it', (_label, over, missing) => {
    const d = decideStaffEligibility(allMet(over as Partial<StaffFacts>), NOW)
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual(missing)
  })
  it('lists every missing prerequisite at once, for the checklist', () => {
    const d = decideStaffEligibility(allMet({ mfa: false, training: null, agreementCompletedAt: null, agreementInFlight: true }), NOW)
    expect(d.missing).toEqual(['agreement', 'training', 'mfa'])
    expect(d.checks.find((c) => c.key === 'agreement')?.message).toMatch(/out for their signature/)
  })
})

describe('staffExpiry and nextState', () => {
  it('is three years from activation, capped by the earliest prerequisite', () => {
    expect(staffExpiry('2026-11-13T12:00:00Z', null)).toBe('2029-11-13T12:00:00.000Z')
    expect(staffExpiry('2026-11-13T12:00:00Z', '2028-06-30')).toBe('2028-06-30T23:59:59.999Z')
  })
  const d = (ok: boolean) => decideStaffEligibility(ok ? allMet() : allMet({ mfa: false }), NOW)
  it('pending activates when everything is met, and stays pending otherwise', () => {
    expect(nextState({ status: 'pending', activated_at: null, expires_at: null }, d(true), NOW)).toMatchObject({ to: 'active', first: true, activatedAt: NOW.toISOString() })
    expect(nextState({ status: 'pending', activated_at: null, expires_at: null }, d(false), NOW)).toEqual({ to: 'pending', missing: ['mfa'] })
  })
  it('active suspends when something lapses, and suspended resumes on its first activation date', () => {
    expect(nextState({ status: 'active', activated_at: '2026-01-01T00:00:00Z', expires_at: '2028-01-01T00:00:00Z' }, d(false), NOW)).toEqual({ to: 'suspended', missing: ['mfa'] })
    expect(nextState({ status: 'suspended', activated_at: '2026-01-01T00:00:00Z', expires_at: '2028-01-01T00:00:00Z' }, d(true), NOW)).toMatchObject({ to: 'active', first: false, activatedAt: '2026-01-01T00:00:00Z' })
  })
  it('an active grant past its expiry expires, whatever else holds', () => {
    expect(nextState({ status: 'active', activated_at: '2023-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z' }, d(true), NOW)).toEqual({ to: 'expired' })
  })
  it('a suspended grant whose term has run out cannot resume', () => {
    expect(nextState({ status: 'suspended', activated_at: '2023-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z' }, d(true), NOW)).toEqual({ to: 'expired' })
  })
})

describe('reminderDue', () => {
  const exp = '2027-01-01T00:00:00Z'
  it('reminds at 60 days and again at 30, never twice in one window', () => {
    expect(reminderDue(exp, null, new Date('2026-10-01T00:00:00Z'))).toBe(false) // 92 days left
    expect(reminderDue(exp, null, new Date('2026-11-10T00:00:00Z'))).toBe(true) // 52 days
    expect(reminderDue(exp, '2026-11-10T00:00:00Z', new Date('2026-11-20T00:00:00Z'))).toBe(false) // still the 60-day window
    expect(reminderDue(exp, '2026-11-10T00:00:00Z', new Date('2026-12-05T00:00:00Z'))).toBe(true) // 27 days: the 30-day window
    expect(reminderDue(exp, '2026-12-05T00:00:00Z', new Date('2026-12-20T00:00:00Z'))).toBe(false)
  })
})

// ── Writes, against an in-memory database and a fake Clerk ───────────────────

function fakeClerk(role: string | null, opts: { mfa?: boolean } = {}) {
  const state = { role, revoked: 0 }
  const clerk: StaffClerk = {
    getUser: async () => ({ publicMetadata: state.role ? { role: state.role } : {}, twoFactorEnabled: opts.mfa ?? true }),
    updateUserMetadata: async (_id, p) => { state.role = (p.publicMetadata.role as string | null) ?? null; return {} },
    revokeSessions: async () => { state.revoked++; return 1 },
  }
  return { clerk, state }
}

let db: FakeDb
beforeEach(() => {
  sendEmail.mockClear()
  audit.mockClear()
  issueStaffAgreement.mockClear()
  db = fakeSupabase({
    members: [{ id: MEMBER, first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', clerk_user_id: CLERK }],
    staff_grants: [],
    event_manager_assignments: [],
    tenant_memberships: [],
    agreements: [],
  })
})

const grantRow = (over: Record<string, unknown> = {}) => ({
  id: 'g-1', member_id: MEMBER, clerk_user_id: null, status: 'pending', granted_at: '2026-11-01T00:00:00Z', granted_by_label: 'Admin',
  activated_at: null, expires_at: null, suspended_at: null, missing: [], ended_at: null, ended_reason: null, agreement_id: null, reminded_at: null, ...over,
})

describe('reconcileStaffGrant', () => {
  it('activates a pending grant: sets the Clerk role, the membership, the expiry, and tells them', async () => {
    db.table('staff_grants').push(grantRow())
    const { clerk, state } = fakeClerk(null)
    const r = await reconcileStaffGrant(db.client, MEMBER, { reason: 'test', clerk, now: NOW, facts: allMet() })
    expect(r.transition).toBe('active')
    expect(state.role).toBe('staff')
    expect(db.table('staff_grants')[0]).toMatchObject({ status: 'active', clerk_user_id: CLERK, expires_at: '2028-06-30T23:59:59.999Z' })
    expect(db.table('tenant_memberships')).toMatchObject([{ clerk_user_id: CLERK, role: 'staff' }])
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'staff.activate' })
  })
  it('replaces an event_manager role with staff, which covers every event anyway', async () => {
    db.table('staff_grants').push(grantRow())
    const { clerk, state } = fakeClerk('event_manager')
    await reconcileStaffGrant(db.client, MEMBER, { reason: 'test', clerk, now: NOW, facts: allMet() })
    expect(state.role).toBe('staff')
  })
  it('never touches an admin’s role', async () => {
    db.table('staff_grants').push(grantRow())
    const { clerk, state } = fakeClerk('admin')
    await reconcileStaffGrant(db.client, MEMBER, { reason: 'test', clerk, now: NOW, facts: allMet() })
    expect(state.role).toBe('admin')
  })
  it('suspends an active grant when MFA goes off: clears the role, ends sessions, drops the membership', async () => {
    db.table('staff_grants').push(grantRow({ status: 'active', clerk_user_id: CLERK, activated_at: '2026-11-01T00:00:00Z', expires_at: '2028-06-30T23:59:59.999Z' }))
    db.table('tenant_memberships').push({ id: 't1', tenant_id: '00000000-0000-4000-8000-000000000001', clerk_user_id: CLERK, member_id: null, role: 'staff', source: 'admin' })
    const { clerk, state } = fakeClerk('staff')
    const r = await reconcileStaffGrant(db.client, MEMBER, { reason: 'login_updated', clerk, now: NOW, facts: allMet({ mfa: false }) })
    expect(r.transition).toBe('suspended')
    expect(state.role).toBeNull()
    expect(state.revoked).toBe(1)
    expect(db.table('staff_grants')[0]).toMatchObject({ status: 'suspended', missing: ['mfa'] })
    expect(db.table('tenant_memberships')).toEqual([])
  })
  it('a suspended Staff member who still manages an event goes back to event_manager', async () => {
    db.table('staff_grants').push(grantRow({ status: 'active', clerk_user_id: CLERK, activated_at: '2026-11-01T00:00:00Z', expires_at: '2028-06-30T23:59:59.999Z' }))
    db.table('event_manager_assignments').push({ id: 'a1', clerk_user_id: CLERK, event_slug: 'nv', expires_at: '2027-01-01T00:00:00Z' })
    const { clerk, state } = fakeClerk('staff')
    await reconcileStaffGrant(db.client, MEMBER, { reason: 'test', clerk, now: NOW, facts: allMet({ training: null }) })
    expect(state.role).toBe('event_manager')
  })
  it('records what is missing on a pending grant without touching Clerk or emailing', async () => {
    db.table('staff_grants').push(grantRow())
    const { clerk, state } = fakeClerk(null)
    const r = await reconcileStaffGrant(db.client, MEMBER, { reason: 'test', clerk, now: NOW, facts: allMet({ mfa: false, training: null }) })
    expect(r.transition).toBe('pending')
    expect(state.role).toBeNull()
    expect(db.table('staff_grants')[0].missing).toEqual(['training', 'mfa'])
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('does nothing for a member with no live grant', async () => {
    const r = await reconcileStaffGrant(db.client, MEMBER, { reason: 'test', clerk: fakeClerk(null).clerk, now: NOW, facts: allMet() })
    expect(r.transition).toBe('no_grant')
  })
})

describe('revokeStaff', () => {
  it('needs a reason', async () => {
    db.table('staff_grants').push(grantRow({ status: 'active', clerk_user_id: CLERK }))
    expect(await revokeStaff(db.client, { memberId: MEMBER, reason: ' ', actor: { actorType: 'admin' }, clerk: fakeClerk('staff').clerk })).toMatchObject({ ok: false, status: 400 })
  })
  it('ends the grant, clears the role and ends their sessions now', async () => {
    db.table('staff_grants').push(grantRow({ status: 'active', clerk_user_id: CLERK, activated_at: '2026-11-01T00:00:00Z', expires_at: '2028-01-01T00:00:00Z' }))
    const { clerk, state } = fakeClerk('staff')
    const r = await revokeStaff(db.client, { memberId: MEMBER, reason: 'Left the team', actor: { actorType: 'admin', actorLabel: 'Admin' }, clerk, now: NOW })
    expect(r.ok).toBe(true)
    expect(db.table('staff_grants')[0]).toMatchObject({ status: 'revoked', ended_reason: 'Left the team' })
    expect(state.role).toBeNull()
    expect(state.revoked).toBe(1)
    expect(audit.mock.calls.at(-1)?.[0]).toMatchObject({ action: 'staff.revoke' })
  })
})

describe('grantStaff', () => {
  it('refuses an admin, who already has everything Staff has', async () => {
    const r = await grantStaff(db.client, { memberId: MEMBER, actor: { actorType: 'admin' }, clerk: fakeClerk('admin').clerk, now: NOW })
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
  it('refuses a second live grant', async () => {
    db.table('staff_grants').push(grantRow())
    const r = await grantStaff(db.client, { memberId: MEMBER, actor: { actorType: 'admin' }, clerk: fakeClerk(null).clerk, now: NOW })
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
})

describe('setStaffRole and clearStaffRole', () => {
  it('clear leaves any role but staff alone', async () => {
    for (const role of ['admin', 'event_manager', null]) {
      const { clerk, state } = fakeClerk(role)
      expect(await clearStaffRole(db.client, clerk, CLERK, NOW)).toBe('kept')
      expect(state.role).toBe(role)
      expect(state.revoked).toBe(0)
    }
  })
  it('set keeps an admin, and reports a Clerk failure instead of throwing', async () => {
    expect(await setStaffRole(fakeClerk('admin').clerk, CLERK)).toBe('admin')
    const broken: StaffClerk = { getUser: async () => { throw new Error('down') }, updateUserMetadata: async () => ({}), revokeSessions: async () => 0 }
    expect(await setStaffRole(broken, CLERK)).toBe('failed')
  })
})

describe('loadTrainingCompletion', () => {
  it('is not configured until a module with published lessons is chosen, and done when every published lesson is', async () => {
    const t = fakeSupabase({ staff_role_settings: [{ id: true, training_module_id: null }], training_items: [], training_progress: [] })
    expect(await loadTrainingCompletion(t.client, MEMBER)).toBe('not_configured')
    t.table('staff_role_settings')[0].training_module_id = 'mod'
    t.table('training_items').push({ id: 'i1', module_id: 'mod', status: 'published' }, { id: 'i2', module_id: 'mod', status: 'published' }, { id: 'i3', module_id: 'mod', status: 'draft' })
    t.table('training_progress').push({ member_id: MEMBER, item_id: 'i1', status: 'completed', completed_at: '2026-11-01T00:00:00Z' })
    expect(await loadTrainingCompletion(t.client, MEMBER)).toBeNull()
    t.table('training_progress').push({ member_id: MEMBER, item_id: 'i2', status: 'completed', completed_at: '2026-11-05T00:00:00Z' })
    expect(await loadTrainingCompletion(t.client, MEMBER)).toBe('2026-11-05T00:00:00Z')
  })
})
