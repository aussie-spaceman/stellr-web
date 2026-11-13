// The Staff role (13 Nov 2026): between Event Manager (a volunteer for one event)
// and Admin (the whole tenancy), Stellr only. Staff are paid staff or highly
// engaged volunteers who are essentially unpaid staff. They read the whole
// admin portal and write Competitions and Members (lib/authz/capabilities.ts).
//
// Owner decisions this file carries out:
//   • Only an admin grants or revokes Staff (the routes check roles:manage).
//   • A grant ACTIVATES only when every prerequisite is met, and is SUSPENDED
//     the moment one lapses. No override:
//       1. the member: active, a Stellr login, a known date of birth, 18+;
//       2. clearance: a passed Stellr background check, a verified uploaded
//          check or a verified teaching license (as for Event Manager);
//       3. the Staff agreement, signed and valid (3 years);
//       4. the Staff safeguarding and privacy training, completed (3 years);
//       5. MFA on their Stellr login.
//   • A grant lasts 3 years from activation, and never past the clearance, the
//     agreement or the training: renewal means renewing those.
//   • Access ends at once on revoke, suspension or expiry: the Clerk role is
//     cleared and every session the person has is ended.
//   • Every step is in the member's activity log and the audit chain, and the
//     person is emailed what they now hold or lost.
//
// Volunteers with privileged access are held to exactly what paid staff are
// (FERPA's "school official" and HIPAA's "workforce" both include volunteers).
//
// The Clerk role 'staff' is what lib/authz reads; staff_grants is what decides
// it. reconcileStaffGrant is the one writer of both, called on every event
// that can change a prerequisite and by the daily sweep as a backstop.

import type { SupabaseClient } from '@supabase/supabase-js'
import { clerkClient } from '@clerk/nextjs/server'
import { hasActiveAssignment, loadEligibility, type Eligibility } from '@/lib/event-manager'
import { agreementExpiry } from '@/lib/docusign-agreements'
import { logActivity, type Actor } from '@/lib/activity-log'
import { audit } from '@/lib/audit/platform'
import { syncStaffGranted, syncStaffRevoked } from '@/lib/authz/role-sync'
import { reportRoleSyncFailure } from '@/lib/authz/role-sync-report'
import { roleFromClerkUser } from '@/lib/authz/decide'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { sendEmail } from '@/lib/email'
import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { AUTH_APP_URL } from '@/lib/env'
import { formatDateShort } from '@/lib/utils'
import { issueStaffAgreement, staffAgreementDocumentReady, STAFF_AGREEMENT_ENVELOPE_TYPE } from '@/lib/esign/staff-agreement'

export const STAFF_TERM_YEARS = 3
/** Training, like the agreement, is renewed every STAFF_TERM_YEARS. */
export const STAFF_TRAINING_VALID_YEARS = 3
/** Renewal reminders go this many days before a grant expires. */
export const STAFF_RENEWAL_NOTICE_DAYS = [60, 30] as const

const GRANTS = 'staff_grants'
const LIVE = ['pending', 'active', 'suspended'] as const

export type StaffStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'expired'
export type PrereqKey = 'member' | 'clearance' | 'agreement' | 'training' | 'mfa'

// ── Facts and the decision (pure) ───────────────────────────────────────────

export interface StaffFacts {
  /** Member and clearance, as Event Manager decides them (lib/event-manager decideEligibility). */
  eligibility: Eligibility
  /** The latest completed Staff agreement, if any. */
  agreementCompletedAt: string | null
  agreementVersion: string | null
  /** A Staff agreement out for signature. */
  agreementInFlight: boolean
  /** When the training module was completed; null if not; 'not_configured' if no module is chosen. */
  training: string | null | 'not_configured'
  /** MFA on the Clerk login; null when it could not be read (counts as missing). */
  mfa: boolean | null
}

export interface PrereqCheck {
  key: PrereqKey
  ok: boolean
  message: string
  /** The last day (YYYY-MM-DD) this prerequisite holds, when it ends. */
  until: string | null
}

export interface StaffDecision {
  ok: boolean
  checks: PrereqCheck[]
  /** Missing prerequisites, in order. */
  missing: PrereqKey[]
  /** The earliest `until` of the prerequisites that hold: a grant may run no later. */
  until: string | null
}

const day = (d: Date) => d.toISOString().slice(0, 10)

function addYears(iso: string, years: number): Date {
  const d = new Date(iso)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d
}

const MEMBER_MESSAGES: Partial<Record<Exclude<Eligibility, { ok: true }>['code'], string>> = {
  no_member: 'Member not found.',
  inactive: 'This member is deactivated.',
  no_login: 'They need a Stellr login first. Send their account invite from this page.',
  no_dob: 'Add their date of birth. Staff is for adults only.',
  minor: 'Staff is for adults only.',
}

/** May this member hold Staff now, and until when? Pure. */
export function decideStaffEligibility(f: StaffFacts, now: Date = new Date()): StaffDecision {
  const e = f.eligibility
  const memberProblem = !e.ok && e.code in MEMBER_MESSAGES
  const checks: PrereqCheck[] = []

  checks.push(
    memberProblem
      ? { key: 'member', ok: false, message: MEMBER_MESSAGES[(e as { code: keyof typeof MEMBER_MESSAGES }).code] ?? 'Member not eligible.', until: null }
      : { key: 'member', ok: true, message: 'An adult member with a Stellr login.', until: null },
  )

  if (e.ok) {
    checks.push({ key: 'clearance', ok: true, message: `Cleared${e.detail ? ` (${e.detail})` : ''}.`, until: e.clearanceUntil })
  } else if (!memberProblem) {
    checks.push({
      key: 'clearance',
      ok: false,
      message:
        e.code === 'awaiting_verification'
          ? 'Their clearance is waiting verification. An admin verifies the uploaded check or teaching license.'
          : 'They need a passed background check, a verified uploaded check, or a verified teaching license.',
      until: null,
    })
  } else {
    checks.push({ key: 'clearance', ok: false, message: 'Checked once the member details above are in place.', until: null })
  }

  const agreementEnds = f.agreementCompletedAt ? agreementExpiry(f.agreementCompletedAt, 'adult', f.agreementVersion) : null
  const agreementOk = !!f.agreementCompletedAt && (agreementEnds === null || agreementEnds > now)
  checks.push(
    agreementOk
      ? { key: 'agreement', ok: true, message: 'Staff agreement signed.', until: agreementEnds ? day(new Date(agreementEnds.getTime() - 1)) : null }
      : {
          key: 'agreement',
          ok: false,
          message: f.agreementInFlight ? 'The Staff agreement is out for their signature.' : f.agreementCompletedAt ? 'Their Staff agreement has lapsed. Send a new one.' : 'The Staff agreement has not been sent.',
          until: null,
        },
  )

  if (f.training === 'not_configured') {
    checks.push({ key: 'training', ok: false, message: 'No Staff training module is chosen yet. An admin sets it first.', until: null })
  } else {
    const ends = f.training ? addYears(f.training, STAFF_TRAINING_VALID_YEARS) : null
    const ok = !!ends && ends > now
    checks.push(
      ok
        ? { key: 'training', ok: true, message: 'Staff training complete.', until: day(new Date(ends!.getTime() - 1)) }
        : { key: 'training', ok: false, message: f.training ? 'Their Staff training has lapsed. They complete it again.' : 'They have not completed the Staff training yet.', until: null },
    )
  }

  checks.push(
    f.mfa === true
      ? { key: 'mfa', ok: true, message: 'Two-step verification is on.', until: null }
      : { key: 'mfa', ok: false, message: f.mfa === null ? 'Their two-step verification could not be checked.' : 'They turn on two-step verification for their Stellr login.', until: null },
  )

  const missing = checks.filter((c) => !c.ok).map((c) => c.key)
  const untils = checks.filter((c) => c.ok && c.until).map((c) => c.until as string).sort()
  return { ok: missing.length === 0, checks, missing, until: untils[0] ?? null }
}

/** When an active grant ends: three years from activation, never past a prerequisite. */
export function staffExpiry(activatedAt: string, until: string | null): string {
  const term = addYears(activatedAt, STAFF_TERM_YEARS)
  const cap = until ? new Date(`${until}T23:59:59.999Z`) : null
  return (cap && cap < term ? cap : term).toISOString()
}

export type Transition =
  | { to: 'active'; activatedAt: string; expiresAt: string; first: boolean }
  | { to: 'active_refresh'; expiresAt: string }
  | { to: 'suspended'; missing: PrereqKey[] }
  | { to: 'expired' }
  | { to: 'pending'; missing: PrereqKey[] }
  | { to: 'none' }

/** What a live grant becomes, given the decision. Pure. */
export function nextState(grant: { status: StaffStatus; activated_at: string | null; expires_at: string | null }, d: StaffDecision, now: Date = new Date()): Transition {
  if (grant.status === 'active' && grant.expires_at && new Date(grant.expires_at) <= now) return { to: 'expired' }
  if (d.ok) {
    if (grant.status === 'active') return { to: 'active_refresh', expiresAt: staffExpiry(grant.activated_at ?? now.toISOString(), d.until) }
    const activatedAt = grant.status === 'suspended' && grant.activated_at ? grant.activated_at : now.toISOString()
    const expiresAt = staffExpiry(activatedAt, d.until)
    if (new Date(expiresAt) <= now) return { to: 'expired' }
    return { to: 'active', activatedAt, expiresAt, first: grant.status === 'pending' }
  }
  if (grant.status === 'active') return { to: 'suspended', missing: d.missing }
  return grant.status === 'pending' ? { to: 'pending', missing: d.missing } : { to: 'none' }
}

// ── Clerk ───────────────────────────────────────────────────────────────────

export interface StaffClerk {
  getUser(id: string): Promise<{ publicMetadata?: unknown; twoFactorEnabled?: boolean; primaryEmailAddress?: { emailAddress: string } | null }>
  updateUserMetadata(id: string, params: { publicMetadata: Record<string, unknown> }): Promise<unknown>
  /** End every session the user has, so a lost role takes effect now. */
  revokeSessions(userId: string): Promise<number>
}

export async function defaultStaffClerk(): Promise<StaffClerk> {
  const c = await clerkClient()
  return {
    getUser: (id) => c.users.getUser(id) as never,
    updateUserMetadata: (id, params) => c.users.updateUserMetadata(id, params),
    async revokeSessions(userId) {
      const list = await c.sessions.getSessionList({ userId, status: 'active' })
      for (const s of list.data) await c.sessions.revokeSession(s.id)
      return list.data.length
    },
  }
}

function roleOf(user: { publicMetadata?: unknown }): string | null {
  const r = roleFromClerkUser(user)
  return typeof r === 'string' && r !== '' ? r : null
}

/** Set the Clerk role to 'staff'. An admin keeps 'admin'; any other role (event_manager, none) becomes staff. */
export async function setStaffRole(clerk: StaffClerk, clerkUserId: string): Promise<'set' | 'kept' | 'admin' | 'failed'> {
  try {
    const role = roleOf(await clerk.getUser(clerkUserId))
    if (role === 'admin') return 'admin'
    if (role === 'staff') return 'kept'
    await clerk.updateUserMetadata(clerkUserId, { publicMetadata: { role: 'staff' } })
    return 'set'
  } catch (err) {
    console.error('[staff] Clerk role set failed:', err)
    return 'failed'
  }
}

/**
 * Take Staff away: the role goes back to event_manager if they still hold an
 * event in force, else to none. Never touches an admin or a role we don't know.
 * Ends every session, so the change applies now rather than at the next token refresh.
 */
export async function clearStaffRole(db: SupabaseClient, clerk: StaffClerk, clerkUserId: string, now: Date = new Date()): Promise<'cleared' | 'to_event_manager' | 'kept' | 'failed'> {
  try {
    const role = roleOf(await clerk.getUser(clerkUserId))
    if (role !== 'staff') return 'kept'
    const next = (await hasActiveAssignment(db, clerkUserId, now)) ? 'event_manager' : null
    await clerk.updateUserMetadata(clerkUserId, { publicMetadata: { role: next } })
    await clerk.revokeSessions(clerkUserId).catch((err) => console.error('[staff] session revoke failed:', err))
    return next ? 'to_event_manager' : 'cleared'
  } catch (err) {
    console.error('[staff] Clerk role clear failed:', err)
    return 'failed'
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────

export interface StaffGrantRow {
  id: string
  member_id: string
  clerk_user_id: string | null
  status: StaffStatus
  granted_at: string
  granted_by_label: string | null
  activated_at: string | null
  expires_at: string | null
  suspended_at: string | null
  missing: string[]
  ended_at: string | null
  ended_reason: string | null
  agreement_id: string | null
  reminded_at: string | null
}

const GRANT_COLUMNS =
  'id, member_id, clerk_user_id, status, granted_at, granted_by_label, activated_at, expires_at, suspended_at, missing, ended_at, ended_reason, agreement_id, reminded_at'

export async function loadLiveGrant(db: SupabaseClient, memberId: string): Promise<StaffGrantRow | null> {
  const { data, error } = await db.from(GRANTS).select(GRANT_COLUMNS).eq('member_id', memberId).in('status', [...LIVE]).maybeSingle()
  if (error) throw new Error(`staff grant read failed: ${error.message}`)
  return (data as StaffGrantRow | null) ?? null
}

/** The member's grants, newest first: the live one and any that ended. */
export async function loadGrantHistory(db: SupabaseClient, memberId: string): Promise<StaffGrantRow[]> {
  const { data, error } = await db.from(GRANTS).select(GRANT_COLUMNS).eq('member_id', memberId).order('granted_at', { ascending: false })
  if (error) throw new Error(`staff grant read failed: ${error.message}`)
  return (data ?? []) as StaffGrantRow[]
}

interface StaffMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  clerk_user_id: string | null
}

async function loadMemberBasics(db: SupabaseClient, memberId: string): Promise<StaffMember | null> {
  const { data, error } = await db.from('members').select('id, first_name, last_name, email, clerk_user_id').eq('id', memberId).maybeSingle()
  if (error) throw new Error(`member read failed: ${error.message}`)
  return (data as StaffMember | null) ?? null
}

/** When the member completed every published lesson of the Staff training module; 'not_configured' if none is chosen or it has no lessons. */
export async function loadTrainingCompletion(db: SupabaseClient, memberId: string): Promise<string | null | 'not_configured'> {
  const { data: settings, error } = await db.from('staff_role_settings').select('training_module_id').eq('id', true).maybeSingle()
  if (error) throw new Error(`staff settings read failed: ${error.message}`)
  const moduleId = (settings as { training_module_id: string | null } | null)?.training_module_id
  if (!moduleId) return 'not_configured'
  const { data: items, error: itemsError } = await db.from('training_items').select('id, status').eq('module_id', moduleId)
  if (itemsError) throw new Error(`training read failed: ${itemsError.message}`)
  const ids = ((items ?? []) as { id: string; status: string | null }[]).filter((i) => i.status !== 'draft').map((i) => i.id)
  if (ids.length === 0) return 'not_configured'
  const { data: progress, error: progressError } = await db
    .from('training_progress')
    .select('item_id, completed_at')
    .eq('member_id', memberId)
    .eq('status', 'completed')
    .in('item_id', ids)
  if (progressError) throw new Error(`training progress read failed: ${progressError.message}`)
  const rows = (progress ?? []) as { item_id: string; completed_at: string | null }[]
  const done = new Map(rows.map((r) => [r.item_id, r.completed_at]))
  if (!ids.every((id) => done.has(id))) return null
  // Completed when the last lesson was; a row with no timestamp counts as long ago, so it renews sooner.
  return ids.map((id) => done.get(id) ?? '1970-01-01T00:00:00Z').sort().at(-1) ?? null
}

export async function loadStaffFacts(db: SupabaseClient, memberId: string, clerk?: StaffClerk, now: Date = new Date()): Promise<StaffFacts> {
  const [eligibility, member, agreements, training] = await Promise.all([
    loadEligibility(db, memberId, now),
    loadMemberBasics(db, memberId),
    db
      .from('agreements')
      .select('status, completed_at, agreement_version')
      .eq('member_id', memberId)
      .eq('envelope_type', STAFF_AGREEMENT_ENVELOPE_TYPE)
      .order('created_at', { ascending: false })
      .limit(20),
    loadTrainingCompletion(db, memberId),
  ])
  if (agreements.error) throw new Error(`staff agreement read failed: ${agreements.error.message}`)
  const rows = (agreements.data ?? []) as { status: string; completed_at: string | null; agreement_version: string | null }[]
  const signed = rows.filter((r) => r.status === 'completed' && r.completed_at).sort((a, b) => (b.completed_at as string).localeCompare(a.completed_at as string))[0]
  let mfa: boolean | null = false
  if (member?.clerk_user_id) {
    try {
      const u = await (clerk ?? (await defaultStaffClerk())).getUser(member.clerk_user_id)
      mfa = u.twoFactorEnabled === true
    } catch (err) {
      console.error('[staff] Clerk MFA read failed:', err)
      mfa = null
    }
  }
  return {
    eligibility,
    agreementCompletedAt: signed?.completed_at ?? null,
    agreementVersion: signed?.agreement_version ?? null,
    agreementInFlight: rows.some((r) => ['created', 'sent', 'delivered'].includes(r.status)),
    training,
    mfa,
  }
}

// ── Emails ──────────────────────────────────────────────────────────────────

const name = (m: StaffMember | null) => `${m?.first_name ?? ''}`.trim() || 'there'

const PREREQ_LABEL: Record<PrereqKey, string> = {
  member: 'Your Stellr account',
  clearance: 'Background check',
  agreement: 'Staff agreement',
  training: 'Staff safeguarding and privacy training',
  mfa: 'Two-step verification on your Stellr login',
}

function checklistHtml(d: StaffDecision): string {
  return `<ul>${d.checks.map((c) => `<li>${c.ok ? '✓' : '○'} <strong>${esc(PREREQ_LABEL[c.key])}</strong>: ${esc(c.message)}</li>`).join('')}</ul>`
}

async function tell(member: StaffMember | null, subject: string, heading: string, bodyHtml: string, text: string): Promise<void> {
  if (!member?.email) return
  try {
    await sendEmail({ to: member.email, subject, html: emailLayout({ heading, bodyHtml, preheader: subject }), text })
  } catch (err) {
    console.error('[staff] email failed (non-fatal):', err)
  }
}

// ── Audit ───────────────────────────────────────────────────────────────────

async function record(
  db: SupabaseClient,
  memberId: string,
  actor: Actor & { clerkUserId?: string | null },
  action: 'staff.grant' | 'staff.activate' | 'staff.suspend' | 'staff.revoke' | 'staff.expire',
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await logActivity({ memberId, category: 'account', action: action.replace('.', '_'), summary, actorType: actor.actorType, actorMemberId: actor.actorMemberId ?? null, actorLabel: actor.actorLabel ?? null, metadata }, db)
  await audit({
    tenantId: STELLR_TENANT_ID,
    actor: actor.clerkUserId ?? (actor.actorType === 'system' ? 'system' : 'admin'),
    action,
    target: { table: GRANTS, id: memberId },
    metadata,
  }, { db })
}

const SYSTEM: Actor = { actorType: 'system', actorLabel: 'Staff role check' }

// ── Grant ───────────────────────────────────────────────────────────────────

export type GrantResult =
  | { ok: true; grant: StaffGrantRow; decision: StaffDecision; agreement: 'sent' | 'on_file' | 'in_flight' | 'document_not_ready' | 'failed' }
  | { ok: false; status: number; error: string }

/**
 * An admin grants Staff. It starts pending; the Staff agreement goes out if
 * none is on file or in flight; it activates as soon as every prerequisite is
 * met, which may be now.
 */
export async function grantStaff(
  db: SupabaseClient,
  args: { memberId: string; actor: Actor & { clerkUserId?: string | null }; clerk?: StaffClerk; now?: Date },
): Promise<GrantResult> {
  const now = args.now ?? new Date()
  const member = await loadMemberBasics(db, args.memberId)
  if (!member) return { ok: false, status: 404, error: 'Member not found.' }
  if (!member.email) return { ok: false, status: 400, error: 'They need an email address first: the Staff agreement is sent to it.' }
  if (await loadLiveGrant(db, member.id)) return { ok: false, status: 409, error: 'They already have a Staff grant. Revoke it first to start again.' }
  const clerk = args.clerk ?? (await defaultStaffClerk())
  if (member.clerk_user_id) {
    try {
      if (roleOf(await clerk.getUser(member.clerk_user_id)) === 'admin') return { ok: false, status: 409, error: 'They are an admin, which already includes everything Staff can do.' }
    } catch (err) {
      console.error('[staff] Clerk read failed on grant:', err)
      return { ok: false, status: 502, error: 'Their Stellr login could not be read. Try again.' }
    }
  }

  const { data, error } = await db
    .from(GRANTS)
    .insert({ member_id: member.id, status: 'pending', granted_by: args.actor.actorMemberId ?? null, granted_by_label: args.actor.actorLabel ?? null, granted_at: now.toISOString() })
    .select(GRANT_COLUMNS)
    .single()
  if (error || !data) {
    if (error?.code === '23505') return { ok: false, status: 409, error: 'They already have a Staff grant.' }
    return { ok: false, status: 500, error: 'The grant could not be saved.' }
  }
  let grant = data as StaffGrantRow

  const facts = await loadStaffFacts(db, member.id, clerk, now)
  let agreement: Extract<GrantResult, { ok: true }>['agreement'] = 'on_file'
  const agreementCheck = decideStaffEligibility(facts, now).checks.find((c) => c.key === 'agreement')
  if (facts.agreementInFlight) agreement = 'in_flight'
  else if (!agreementCheck?.ok) {
    if (!(await staffAgreementDocumentReady(db))) agreement = 'document_not_ready'
    else {
      try {
        const { agreementId } = await issueStaffAgreement(db, { memberId: member.id, firstName: member.first_name ?? '', lastName: member.last_name ?? '', email: member.email })
        await db.from(GRANTS).update({ agreement_id: agreementId, updated_at: now.toISOString() }).eq('id', grant.id)
        agreement = 'sent'
        facts.agreementInFlight = true
      } catch (err) {
        console.error('[staff] agreement issue failed:', err)
        agreement = 'failed'
      }
    }
  }

  await record(db, member.id, args.actor, 'staff.grant', 'Granted Staff (activates once every prerequisite is met)', { grantId: grant.id, agreement })
  const reconciled = await reconcileStaffGrant(db, member.id, { reason: 'granted', clerk, now, facts, quiet: true })
  grant = reconciled.grant ?? grant
  const decision = reconciled.decision ?? decideStaffEligibility(facts, now)

  if (grant.status === 'pending') {
    await tell(
      member,
      'You’ve been invited to Stellr Staff',
      'You’ve been invited to Stellr Staff',
      `<p>Hi ${esc(name(member))},</p><p>${esc(args.actor.actorLabel ?? 'A Stellr admin')} has invited you to join Stellr as Staff. Staff can see every event and member record in the Stellr admin portal, so a few things come first. Your access starts on its own once they are all done.</p>${checklistHtml(decision)}<p>Your Staff agreement arrives in a separate email. Turn on two-step verification from your <a href="${AUTH_APP_URL}/account">account page</a>.</p>`,
      `You've been invited to Stellr Staff. Your access starts once these are done: ${decision.checks.map((c) => `${c.ok ? '[done]' : '[to do]'} ${PREREQ_LABEL[c.key]}`).join('; ')}.`,
    )
  }
  return { ok: true, grant, decision, agreement }
}

// ── Reconcile: the one writer of status and the Clerk role ────────────────

export interface ReconcileResult {
  grant: StaffGrantRow | null
  decision: StaffDecision | null
  transition: Transition['to'] | 'no_grant'
}

/**
 * Bring a member's live grant in line with their prerequisites: activate,
 * refresh the expiry, suspend, or expire it, and set or clear the Clerk role to
 * match. Idempotent. Called after anything that can change a prerequisite
 * (agreement signed or voided, clearance changed, training completed, MFA
 * changed) and by the daily sweep.
 */
export async function reconcileStaffGrant(
  db: SupabaseClient,
  memberId: string,
  opts: { reason: string; clerk?: StaffClerk; now?: Date; facts?: StaffFacts; quiet?: boolean },
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date()
  const grant = await loadLiveGrant(db, memberId)
  if (!grant) return { grant: null, decision: null, transition: 'no_grant' }
  const clerk = opts.clerk ?? (await defaultStaffClerk())
  const facts = opts.facts ?? (await loadStaffFacts(db, memberId, clerk, now))
  const decision = decideStaffEligibility(facts, now)
  const t = nextState(grant, decision, now)
  const member = await loadMemberBasics(db, memberId)
  const iso = now.toISOString()
  const update = async (patch: Record<string, unknown>) => {
    const { data, error } = await db.from(GRANTS).update({ ...patch, updated_at: iso }).eq('id', grant.id).in('status', [...LIVE]).select(GRANT_COLUMNS).maybeSingle()
    if (error) throw new Error(`staff grant update failed: ${error.message}`)
    return (data as StaffGrantRow | null) ?? grant
  }

  switch (t.to) {
    case 'active': {
      if (!member?.clerk_user_id) return { grant, decision, transition: 'none' }
      const role = await setStaffRole(clerk, member.clerk_user_id)
      if (role === 'failed') return { grant, decision, transition: 'none' }
      const next = await update({ status: 'active', clerk_user_id: member.clerk_user_id, activated_at: t.activatedAt, expires_at: t.expiresAt, suspended_at: null, missing: [] })
      await reportRoleSyncFailure('staff_grant', await syncStaffGranted(db, member.clerk_user_id), { method: 'POST', routePath: 'lib/staff' })
      await record(db, memberId, SYSTEM, 'staff.activate', `Staff access started (until ${formatDateShort(day(new Date(t.expiresAt)))})`, { grantId: grant.id, reason: opts.reason, expiresAt: t.expiresAt, resumed: !t.first })
      await tell(
        member,
        t.first ? 'Your Stellr Staff access has started' : 'Your Stellr Staff access is back',
        t.first ? 'Your Staff access has started' : 'Your Staff access is back',
        `<p>Hi ${esc(name(member))},</p><p>Everything is in place, so your Staff access to the <a href="${AUTH_APP_URL}/admin">Stellr admin portal</a> is on until ${esc(formatDateShort(day(new Date(t.expiresAt))))}. Sign in again if you were signed in already.</p><p>What you see there includes students’ personal details. Use it only for your Stellr work, keep it on the platform, and contact families only through Stellr, as your Staff agreement sets out.</p>`,
        `Your Stellr Staff access is on until ${day(new Date(t.expiresAt))}. Sign in again if you were already signed in.`,
      )
      return { grant: next, decision, transition: 'active' }
    }
    case 'active_refresh': {
      if (grant.expires_at === t.expiresAt) return { grant, decision, transition: 'none' }
      const next = await update({ expires_at: t.expiresAt })
      return { grant: next, decision, transition: 'active_refresh' }
    }
    case 'suspended': {
      const next = await update({ status: 'suspended', suspended_at: iso, missing: t.missing })
      if (grant.clerk_user_id) {
        await clearStaffRole(db, clerk, grant.clerk_user_id, now)
        await reportRoleSyncFailure('staff_revoke', await syncStaffRevoked(db, grant.clerk_user_id), { method: 'POST', routePath: 'lib/staff' })
      }
      await record(db, memberId, SYSTEM, 'staff.suspend', `Staff access paused: ${t.missing.map((k) => PREREQ_LABEL[k]).join(', ')} no longer in place`, { grantId: grant.id, reason: opts.reason, missing: t.missing })
      await tell(
        member,
        'Your Stellr Staff access is paused',
        'Your Staff access is paused',
        `<p>Hi ${esc(name(member))},</p><p>Your Staff access is paused because something it depends on is no longer in place. It comes back on its own once it is.</p>${checklistHtml(decision)}`,
        `Your Stellr Staff access is paused until these are in place again: ${t.missing.map((k) => PREREQ_LABEL[k]).join(', ')}.`,
      )
      return { grant: next, decision, transition: 'suspended' }
    }
    case 'expired': {
      const next = await update({ status: 'expired', ended_at: iso, ended_reason: 'term_ended' })
      if (grant.clerk_user_id) {
        await clearStaffRole(db, clerk, grant.clerk_user_id, now)
        await reportRoleSyncFailure('staff_revoke', await syncStaffRevoked(db, grant.clerk_user_id), { method: 'POST', routePath: 'lib/staff' })
      }
      await record(db, memberId, SYSTEM, 'staff.expire', 'Staff access ended: the term ran out', { grantId: grant.id })
      await tell(
        member,
        'Your Stellr Staff access has ended',
        'Your Staff access has ended',
        `<p>Hi ${esc(name(member))},</p><p>Your Staff access reached the end of its term. An admin can grant it again, and you would renew your agreement and training.</p>`,
        'Your Stellr Staff access has ended. An admin can grant it again.',
      )
      return { grant: next, decision, transition: 'expired' }
    }
    case 'pending': {
      const same = [...grant.missing].sort().join(',') === [...t.missing].sort().join(',')
      const next = same ? grant : await update({ missing: t.missing })
      return { grant: next, decision, transition: 'pending' }
    }
    default:
      return { grant, decision, transition: 'none' }
  }
}

// ── Revoke ──────────────────────────────────────────────────────────────────

export type RevokeResult = { ok: true; grant: StaffGrantRow } | { ok: false; status: number; error: string }

/** An admin ends a grant, whatever its state. Access ends now: the role is cleared and every session ended. */
export async function revokeStaff(
  db: SupabaseClient,
  args: { memberId: string; reason: string; actor: Actor & { clerkUserId?: string | null }; clerk?: StaffClerk; now?: Date },
): Promise<RevokeResult> {
  const now = args.now ?? new Date()
  const reason = args.reason.trim()
  if (!reason) return { ok: false, status: 400, error: 'Say why Staff is being removed.' }
  const grant = await loadLiveGrant(db, args.memberId)
  if (!grant) return { ok: false, status: 404, error: 'They have no Staff grant.' }
  const clerk = args.clerk ?? (await defaultStaffClerk())
  const { data, error } = await db
    .from(GRANTS)
    .update({ status: 'revoked', ended_at: now.toISOString(), ended_by: args.actor.actorMemberId ?? null, ended_reason: reason.slice(0, 500), updated_at: now.toISOString() })
    .eq('id', grant.id)
    .in('status', [...LIVE])
    .select(GRANT_COLUMNS)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'The grant could not be updated.' }
  const clerkUserId = grant.clerk_user_id ?? (await loadMemberBasics(db, args.memberId))?.clerk_user_id ?? null
  if (clerkUserId) {
    await clearStaffRole(db, clerk, clerkUserId, now)
    await reportRoleSyncFailure('staff_revoke', await syncStaffRevoked(db, clerkUserId), { method: 'DELETE', routePath: 'lib/staff' })
  }
  await record(db, args.memberId, args.actor, 'staff.revoke', `Removed Staff: ${reason.slice(0, 200)}`, { grantId: grant.id, from: grant.status })
  if (grant.status !== 'pending') {
    const member = await loadMemberBasics(db, args.memberId)
    await tell(
      member,
      'Your Stellr Staff access has ended',
      'Your Staff access has ended',
      `<p>Hi ${esc(name(member))},</p><p>Your Staff access to the Stellr admin portal has ended. Your Staff agreement still applies to anything you saw while you held it: please delete any Stellr data you have outside the platform, and contact us if you have questions.</p>`,
      'Your Stellr Staff access has ended. Please delete any Stellr data you hold outside the platform.',
    )
  }
  return { ok: true, grant: (data as StaffGrantRow | null) ?? grant }
}

// ── Daily sweep ─────────────────────────────────────────────────────────────

export interface StaffSweepResult {
  checked: number
  activated: number
  suspended: number
  expired: number
  reminded: number
  failed: number
}

/** The backstop: reconcile every live grant, and remind anyone whose access ends within 60 or 30 days. */
export async function sweepStaffGrants(db: SupabaseClient, opts: { clerk?: StaffClerk; now?: Date } = {}): Promise<StaffSweepResult> {
  const now = opts.now ?? new Date()
  const out: StaffSweepResult = { checked: 0, activated: 0, suspended: 0, expired: 0, reminded: 0, failed: 0 }
  const { data, error } = await db.from(GRANTS).select('member_id').in('status', [...LIVE]).limit(500)
  if (error) throw new Error(`staff sweep read failed: ${error.message}`)
  const clerk = opts.clerk ?? (await defaultStaffClerk())
  for (const { member_id } of (data ?? []) as { member_id: string }[]) {
    out.checked++
    try {
      const r = await reconcileStaffGrant(db, member_id, { reason: 'daily_sweep', clerk, now })
      if (r.transition === 'active') out.activated++
      if (r.transition === 'suspended') out.suspended++
      if (r.transition === 'expired') out.expired++
      if (r.grant?.status === 'active' && r.grant.expires_at && (await remindIfDue(db, r.grant, now))) out.reminded++
    } catch (err) {
      out.failed++
      console.error('[staff] sweep failed for one grant:', err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** Pure: is a renewal reminder due? One at 60 days and one at 30, never twice for the same window. */
export function reminderDue(expiresAt: string, remindedAt: string | null, now: Date = new Date()): boolean {
  const daysLeft = (new Date(expiresAt).getTime() - now.getTime()) / 86_400_000
  const window = STAFF_RENEWAL_NOTICE_DAYS.filter((d) => daysLeft <= d).at(-1)
  if (window === undefined) return false
  if (!remindedAt) return true
  const daysLeftAtReminder = (new Date(expiresAt).getTime() - new Date(remindedAt).getTime()) / 86_400_000
  return daysLeftAtReminder > window
}

async function remindIfDue(db: SupabaseClient, grant: StaffGrantRow, now: Date): Promise<boolean> {
  if (!grant.expires_at || !reminderDue(grant.expires_at, grant.reminded_at, now)) return false
  const member = await loadMemberBasics(db, grant.member_id)
  await tell(
    member,
    'Your Stellr Staff access ends soon',
    'Your Staff access ends soon',
    `<p>Hi ${esc(name(member))},</p><p>Your Staff access ends on ${esc(formatDateShort(day(new Date(grant.expires_at))))}. To keep it, ask a Stellr admin to renew it: you will sign the Staff agreement again and refresh your training.</p>`,
    `Your Stellr Staff access ends on ${day(new Date(grant.expires_at))}. Ask a Stellr admin to renew it.`,
  )
  await db.from(GRANTS).update({ reminded_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', grant.id)
  return true
}

// ── Nudge: for hooks elsewhere ───────────────────────────────────────────────

/**
 * Something that can change a Staff prerequisite just happened (clearance,
 * training, MFA, an agreement voided). Reconcile the member's grant if they have
 * one. Cheap when they don't (one indexed read), and never throws: the daily
 * sweep is the backstop.
 */
export async function nudgeStaff(db: SupabaseClient, who: { memberId: string } | { clerkUserId: string }, reason: string): Promise<void> {
  try {
    let memberId = 'memberId' in who ? who.memberId : null
    if (!memberId) {
      const { data } = await db.from('members').select('id').eq('clerk_user_id', (who as { clerkUserId: string }).clerkUserId).maybeSingle()
      memberId = (data as { id: string } | null)?.id ?? null
    }
    if (!memberId) return
    const { count } = await db.from(GRANTS).select('id', { count: 'exact', head: true }).eq('member_id', memberId).in('status', [...LIVE])
    if (!count) return
    await reconcileStaffGrant(db, memberId, { reason })
  } catch (err) {
    console.error(`[staff] reconcile after ${reason} failed (the daily sweep retries):`, err instanceof Error ? err.message : err)
  }
}
