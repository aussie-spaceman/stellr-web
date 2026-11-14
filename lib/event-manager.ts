// Event Manager: an event-specific role an admin grants from the member page
// (Classification → Event Manager) or the event's Overview panel. Both go
// through assignEventManager, so the same gate applies everywhere.
//
// Why the gate is strict. An Event Manager can open that event's roster: minors'
// names, dates of birth, medical notes, emergency contacts and background-check
// summaries, plus check-in, emails and exports. So (owner, 9 Nov 2026):
//
//   • Only an admin can grant, change or remove it (the routes check).
//   • Only a cleared adult can hold it: a known date of birth, 18+, an active
//     member with a Stellr login, and clearance on file — a passed Stellr check,
//     a verified uploaded check (lib/external-background-check), or a verified
//     teaching license. Waiting-verification does not count. No override.
//   • It is time-boxed. Default: the event's last day + 30 days. An admin can
//     edit the date, but never past the person's clearance, nor more than a year
//     past the later of today and the event. Readers ignore expired rows
//     (activeAssignmentFilter), so access ends at the expiry even before the
//     daily sweep deletes the row.
//   • Clearance is re-checked: when an admin withdraws it (unverify, delete,
//     adjudicate not-cleared) the person loses every assignment at once
//     (recheckEventManagerClearance), and the daily sweep catches anything that
//     lapsed on its own (sweepEventManagers).
//   • The Clerk role (publicMetadata.role = 'event_manager') that opens the
//     portal is set on the first assignment and cleared with the last. An
//     admin's role is never touched, and nor is any other role we don't know.
//   • Every grant, change and removal is in the member's activity log, and the
//     person is emailed what they now hold (or lost) and what they owe it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { clerkClient } from '@clerk/nextjs/server'
import { deriveCompliance, externalCheckValidUntil, firstExternalCheck, type ComplianceSummary, type ExternalBackgroundCheck, type TeacherLicense, type BackgroundCheck } from '@/lib/compliance'
import { isKnownMinorOn, isValidDob } from '@/lib/age'
import { getEventBySlug } from '@/lib/events/repo'
import { eventLastDay, formatDateShort } from '@/lib/utils'
import { logActivity, type Actor } from '@/lib/activity-log'
import { syncEventManagerAssigned, syncEventManagerUnassigned, loadAssignmentTenantId } from '@/lib/authz/role-sync'
import { reportRoleSyncFailure, roleSyncMetadata } from '@/lib/authz/role-sync-report'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { roleFromClerkUser } from '@/lib/authz/decide'
import { sendEmail } from '@/lib/email'
import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { AUTH_APP_URL } from '@/lib/env'
import { activeAssignmentFilter, isAssignmentActive } from '@/lib/event-manager-active'

export const EVENT_MANAGER_GRACE_DAYS = 30
/** An override may run at most this many days past the later of today and the event's last day. */
export const EVENT_MANAGER_MAX_EXTENSION_DAYS = 365

const TABLE = 'event_manager_assignments'

// ── Active rows ─────────────────────────────────────────────────────────────

export { activeAssignmentFilter, isAssignmentActive }

// ── Dates ───────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** An expiry date (YYYY-MM-DD) is stored as the end of that day, UTC: access runs through the whole date. */
export function expiryDateToTimestamp(isoDate: string): string {
  return `${isoDate}T23:59:59.999Z`
}

/** The date (YYYY-MM-DD) an expiry timestamp falls on, as shown on the member page. */
export function expiryTimestampToDate(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** Default expiry: the event's last day + 30 days. An undated event (most campaigns) counts from today. */
export function defaultExpiryDate(event: { date?: string | null; endDate?: string | null }, now: Date = new Date()): string {
  const last = eventLastDay(event)?.slice(0, 10)
  return addDays(last && ISO_DATE.test(last) ? last : todayIso(now), EVENT_MANAGER_GRACE_DAYS)
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export type ClearanceBasis = 'background_check' | 'external_background_check' | 'teacher_license'

export type Eligibility =
  | { ok: true; basis: ClearanceBasis; clearanceUntil: string | null; detail: string | null }
  | { ok: false; code: 'no_member' | 'inactive' | 'no_login' | 'no_dob' | 'minor' | 'awaiting_verification' | 'not_cleared'; message: string }

export interface EligibilityMember {
  is_active: boolean | null
  clerk_user_id: string | null
  date_of_birth: string | null
}

/** The last day (YYYY-MM-DD) the person's clearance counts, from what cleared them. */
function clearanceUntil(summary: ComplianceSummary): string | null {
  if (summary.clearedBy === 'external_background_check' && summary.external) return externalCheckValidUntil(summary.external)
  if (summary.clearedBy === 'teacher_license' && summary.license) return summary.license.expiry_date.slice(0, 10)
  if (summary.clearedBy === 'background_check' && summary.check?.expires_at) return summary.check.expires_at.slice(0, 10)
  return null
}

/**
 * May this member hold Event Manager access? Pure. `summary` must be derived as
 * a BC-required role ('mentor'), so a member still classified 'subscriber' is
 * judged on clearance, not waved through as not-required.
 */
export function decideEligibility(member: EligibilityMember | null, summary: ComplianceSummary | null, now: Date = new Date()): Eligibility {
  if (!member) return { ok: false, code: 'no_member', message: 'Member not found.' }
  if (member.is_active === false) return { ok: false, code: 'inactive', message: 'This member is deactivated.' }
  if (!member.clerk_user_id) {
    return { ok: false, code: 'no_login', message: 'They need a Stellr login first. Send their account invite from this page, then try again.' }
  }
  if (!isValidDob(member.date_of_birth)) {
    return { ok: false, code: 'no_dob', message: 'Add their date of birth first. Event Manager access is for adults only.' }
  }
  if (isKnownMinorOn(member.date_of_birth, now)) {
    return { ok: false, code: 'minor', message: 'Event Manager access is for adults only.' }
  }
  if (!summary) return { ok: false, code: 'not_cleared', message: 'Their clearance could not be read. Try again.' }
  if (summary.state === 'valid_bc' || summary.state === 'valid_license') {
    const basis: ClearanceBasis = summary.clearedBy ?? (summary.state === 'valid_license' ? 'teacher_license' : 'background_check')
    return { ok: true, basis, clearanceUntil: clearanceUntil(summary), detail: summary.detail }
  }
  if (summary.state === 'awaiting_verification') {
    return {
      ok: false,
      code: 'awaiting_verification',
      message: 'Their clearance is waiting verification. Verify the uploaded check or teaching license under Background Check first.',
    }
  }
  return {
    ok: false,
    code: 'not_cleared',
    message: `They need clearance first: a passed background check, a verified uploaded check, or a verified teaching license.${summary.detail ? ` (${summary.detail}.)` : ''}`,
  }
}

/**
 * Check an expiry date against the rules. Returns an error message or null.
 * `eventLast` is the event's last day, or null when undated.
 */
export function validateExpiryDate(
  expiresOn: string,
  opts: { eventLast: string | null; clearanceUntil: string | null; now?: Date },
): string | null {
  const now = opts.now ?? new Date()
  if (!ISO_DATE.test(expiresOn) || Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`))) return 'Expiry date must be a date (YYYY-MM-DD).'
  const today = todayIso(now)
  if (expiresOn < today) return 'The expiry date can’t be in the past.'
  const anchor = opts.eventLast && opts.eventLast > today ? opts.eventLast : today
  const cap = addDays(anchor, EVENT_MANAGER_MAX_EXTENSION_DAYS)
  if (expiresOn > cap) return `The expiry can be at most a year after the event (${formatDateShort(cap)}).`
  if (opts.clearanceUntil && expiresOn > opts.clearanceUntil) {
    return `Their clearance runs out on ${formatDateShort(opts.clearanceUntil)}. The expiry can’t be later than that.`
  }
  return null
}

// ── Loading ─────────────────────────────────────────────────────────────────

interface MemberRow extends EligibilityMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  member_teacher_licenses: TeacherLicense[] | null
  member_background_checks: BackgroundCheck[] | null
  member_external_background_checks: ExternalBackgroundCheck[] | ExternalBackgroundCheck | null
}

const MEMBER_SELECT = `
  id, first_name, last_name, email, is_active, clerk_user_id, date_of_birth,
  member_teacher_licenses!member_id(id, license_number, licensing_state, expiry_date, verified_at, verified_label, document_path, updated_at),
  member_background_checks!member_id(id, status, result, assessment, includes_canceled, provider_report_ref, ordered_at, completed_at, expires_at, report_pdf_url, adjudicated_at, adjudication_outcome, adjudicated_label, adjudication_notes, provider_adjudication),
  member_external_background_checks!member_id(id, issuer, completed_on, document_expires_on, document_path, verified_at, verified_label, submitted_by, updated_at)
`

function summaryFor(m: MemberRow, now: Date): ComplianceSummary {
  // Derived as 'mentor' (a BC-required role) whatever the member's own role.
  return deriveCompliance(
    m.member_teacher_licenses?.[0] ?? null,
    m.member_background_checks ?? [],
    'mentor',
    m.date_of_birth,
    now.toISOString(),
    firstExternalCheck(m.member_external_background_checks),
  )
}

async function loadMember(db: SupabaseClient, filter: { id: string } | { clerkUserId: string }): Promise<MemberRow | null> {
  const q = db.from('members').select(MEMBER_SELECT)
  const { data, error } = await ('id' in filter ? q.eq('id', filter.id) : q.eq('clerk_user_id', filter.clerkUserId)).maybeSingle()
  if (error) throw new Error(`member read failed: ${error.message}`)
  return (data as unknown as MemberRow | null) ?? null
}

export async function loadEligibility(db: SupabaseClient, memberId: string, now: Date = new Date()): Promise<Eligibility> {
  const m = await loadMember(db, { id: memberId })
  return decideEligibility(m, m ? summaryFor(m, now) : null, now)
}

export interface MemberAssignment {
  eventSlug: string
  expiresAt: string | null
  /** YYYY-MM-DD, or null for a row granted before expiries existed. */
  expiresOn: string | null
  active: boolean
  clearanceBasis: ClearanceBasis | null
  grantedByLabel: string | null
  createdAt: string
}

/** A member's assignments (active and lapsed-but-not-yet-swept), newest first. */
export async function loadMemberAssignments(db: SupabaseClient, clerkUserId: string, now: Date = new Date()): Promise<MemberAssignment[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('event_slug, expires_at, clearance_basis, granted_by_label, created_at')
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`assignments read failed: ${error.message}`)
  return ((data ?? []) as { event_slug: string; expires_at: string | null; clearance_basis: ClearanceBasis | null; granted_by_label: string | null; created_at: string }[]).map((r) => ({
    eventSlug: r.event_slug,
    expiresAt: r.expires_at,
    expiresOn: r.expires_at ? expiryTimestampToDate(r.expires_at) : null,
    active: isAssignmentActive(r, now),
    clearanceBasis: r.clearance_basis,
    grantedByLabel: r.granted_by_label,
    createdAt: r.created_at,
  }))
}

// ── Clerk role ──────────────────────────────────────────────────────────────

export interface ClerkUsers {
  getUser(id: string): Promise<{ publicMetadata?: unknown; primaryEmailAddress?: { emailAddress: string } | null }>
  updateUserMetadata(id: string, params: { publicMetadata: Record<string, unknown> }): Promise<unknown>
}

async function clerkUsers(): Promise<ClerkUsers> {
  return (await clerkClient()).users as unknown as ClerkUsers
}

function roleOf(user: { publicMetadata?: unknown }): string | null {
  const r = roleFromClerkUser(user)
  return typeof r === 'string' && r !== '' ? r : null
}

export type RoleChange = 'set' | 'kept' | 'cleared' | 'admin' | 'other_role' | 'failed'

/** Give the Clerk user the event_manager role unless they hold one already (admin, or a role we don't know). */
export async function ensureEventManagerRole(clerkUserId: string, users?: ClerkUsers): Promise<{ change: RoleChange; role: string | null }> {
  try {
    const u = users ?? (await clerkUsers())
    const role = roleOf(await u.getUser(clerkUserId))
    if (role === 'event_manager') return { change: 'kept', role }
    if (role === 'admin') return { change: 'admin', role }
    if (role) return { change: 'other_role', role }
    await u.updateUserMetadata(clerkUserId, { publicMetadata: { role: 'event_manager' } })
    return { change: 'set', role: 'event_manager' }
  } catch (err) {
    console.error('[event-manager] Clerk role set failed:', err)
    return { change: 'failed', role: null }
  }
}

/** Whether the person holds an Event Manager assignment still in force. Throws on a read error. */
export async function hasActiveAssignment(db: SupabaseClient, clerkUserId: string, now: Date = new Date()): Promise<boolean> {
  const { count, error } = await db
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('clerk_user_id', clerkUserId)
    .or(activeAssignmentFilter(now))
  if (error) throw error
  return (count ?? 0) > 0
}

/** Clear the event_manager role once the person has no assignment still in force. Never touches any other role. */
export async function clearEventManagerRoleIfUnused(db: SupabaseClient, clerkUserId: string, users?: ClerkUsers, now: Date = new Date()): Promise<RoleChange> {
  try {
    const { count, error } = await db
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('clerk_user_id', clerkUserId)
      .or(activeAssignmentFilter(now))
    // Fail safe in the direction of the data: if we can't count, leave the role;
    // the assignment rows (or their absence) still decide which events they see.
    if (error) throw error
    if ((count ?? 0) > 0) return 'kept'
    const u = users ?? (await clerkUsers())
    if (roleOf(await u.getUser(clerkUserId)) !== 'event_manager') return 'kept'
    await u.updateUserMetadata(clerkUserId, { publicMetadata: { role: null } })
    return 'cleared'
  } catch (err) {
    console.error('[event-manager] Clerk role clear failed:', err)
    return 'failed'
  }
}

// ── Assign / change ─────────────────────────────────────────────────────────

export type AssignResult =
  | {
      ok: true
      created: boolean
      eventSlug: string
      eventTitle: string
      expiresOn: string
      basis: ClearanceBasis
      role: RoleChange
      warnings: string[]
    }
  | { ok: false; status: number; error: string; code?: string }

/**
 * Grant Event Manager for one event, or change an existing grant's expiry.
 * `expiresOn` (YYYY-MM-DD) overrides the default; omit it for the default on a
 * new grant, or to keep the current date on a re-confirm. The gate runs every
 * time, including a pure date change: extending access re-checks clearance.
 */
export async function assignEventManager(
  db: SupabaseClient,
  args: {
    member: { id: string } | { clerkUserId: string }
    eventSlug: string
    expiresOn?: string | null
    /** PATCH: refuse unless the person already holds this event. */
    requireExisting?: boolean
    actor: Actor
    now?: Date
    users?: ClerkUsers
    /** The calling route, for a role-sync failure report. */
    routePath?: string
  },
): Promise<AssignResult> {
  const now = args.now ?? new Date()
  const slug = args.eventSlug.trim()
  if (!slug) return { ok: false, status: 400, error: 'Choose an event.' }

  const m = await loadMember(db, args.member)
  if (!m) return { ok: false, status: 404, error: 'No Stellr member found for that account.', code: 'no_member' }
  const eligibility = decideEligibility(m, summaryFor(m, now), now)
  if (!eligibility.ok) return { ok: false, status: 409, error: eligibility.message, code: eligibility.code }
  const clerkUserId = m.clerk_user_id!

  const event = (await getEventBySlug(slug)) as { title?: string; date?: string | null; endDate?: string | null } | null
  if (!event) return { ok: false, status: 404, error: 'That event no longer exists.' }
  const eventTitle = event.title ?? slug
  const eventLast = eventLastDay(event)?.slice(0, 10) ?? null

  const { data: existingRow, error: readErr } = await db
    .from(TABLE)
    .select('id, expires_at')
    .eq('clerk_user_id', clerkUserId)
    .eq('event_slug', slug)
    .maybeSingle()
  if (readErr) return { ok: false, status: 500, error: 'Database error' }
  const existing = existingRow as { id: string; expires_at: string | null } | null
  if (args.requireExisting && !existing) return { ok: false, status: 404, error: 'They are not an Event Manager for that event.' }

  const warnings: string[] = []
  let expiresOn = args.expiresOn ?? null
  if (!expiresOn && existing?.expires_at && isAssignmentActive(existing, now)) expiresOn = expiryTimestampToDate(existing.expires_at)
  if (!expiresOn) {
    expiresOn = defaultExpiryDate(event, now)
    // Default never outlives the clearance; an explicit date that does is refused below.
    if (eligibility.clearanceUntil && expiresOn > eligibility.clearanceUntil) {
      if (eventLast && eligibility.clearanceUntil < eventLast) {
        return {
          ok: false,
          status: 409,
          error: `Their clearance runs out on ${formatDateShort(eligibility.clearanceUntil)}, before the event ends. Renew it first.`,
          code: 'clearance_ends_early',
        }
      }
      expiresOn = eligibility.clearanceUntil
      warnings.push(`Expiry set to ${formatDateShort(expiresOn)}, when their clearance runs out.`)
    }
  }
  const dateError = validateExpiryDate(expiresOn, { eventLast, clearanceUntil: eligibility.clearanceUntil, now })
  if (dateError) return { ok: false, status: 400, error: dateError, code: 'bad_expiry' }

  const stamp = now.toISOString()
  const { error } = await db.from(TABLE).upsert(
    {
      clerk_user_id: clerkUserId,
      event_slug: slug,
      member_id: m.id,
      expires_at: expiryDateToTimestamp(expiresOn),
      clearance_basis: eligibility.basis,
      granted_by_label: args.actor.actorLabel ?? null,
      updated_at: stamp,
    },
    { onConflict: 'clerk_user_id,event_slug' },
  )
  if (error) {
    console.error('[event-manager] assignment write error:', error)
    return { ok: false, status: 500, error: 'Database error' }
  }

  const created = !existing
  const role = await ensureEventManagerRole(clerkUserId, args.users)
  if (role.change === 'other_role') warnings.push(`Their Clerk role is “${role.role}”, so it was left alone. They won’t see the Event Manager portal until it is changed in Clerk.`)
  if (role.change === 'failed') warnings.push('The Clerk role could not be set. They won’t see the Event Manager portal until it is. Try again.')

  // S5 C9 dual-write (tenant memberships). Idempotent, so it runs on every grant
  // and re-confirm. Reported, never fails the grant.
  const sync = await syncEventManagerAssigned(db, clerkUserId, slug, STELLR_TENANT_ID)
  await reportRoleSyncFailure('event_manager_assign', sync, { method: 'POST', routePath: args.routePath ?? '/lib/event-manager' })

  // deep review AUTH-6: who granted access to this roster must be recoverable.
  await logActivity(
    {
      ...args.actor,
      memberId: m.id,
      category: 'account',
      action: created ? 'event_manager_assigned' : 'event_manager_expiry_changed',
      summary: created
        ? `Assigned as Event Manager for ${eventTitle} until ${expiresOn}`
        : `Event Manager access for ${eventTitle} now ends ${expiresOn}`,
      metadata: {
        event_slug: slug,
        clerk_user_id: clerkUserId,
        expires_on: expiresOn,
        previous_expires_at: existing?.expires_at ?? null,
        clearance_basis: eligibility.basis,
        clerk_role: role.change,
        ...roleSyncMetadata(sync),
      },
    },
    db,
  )

  if (created && m.email) {
    await sendEmail({
      to: m.email,
      ...eventManagerAssignedEmail({ firstName: m.first_name || 'there', eventTitle, expiresOn, url: `${AUTH_APP_URL}/admin/competitions/${encodeURIComponent(slug)}` }),
    }).catch((err) => {
      console.error('[event-manager] assigned email failed:', err)
      warnings.push('Access granted, but the email to them could not be sent.')
    })
  }

  return { ok: true, created, eventSlug: slug, eventTitle, expiresOn, basis: eligibility.basis, role: role.change, warnings }
}

// ── Remove ──────────────────────────────────────────────────────────────────

export type RemovalReason = 'admin' | 'expired' | 'clearance_lapsed'

const REMOVAL_SUMMARY: Record<RemovalReason, string> = {
  admin: 'Removed as Event Manager',
  expired: 'Event Manager access expired',
  clearance_lapsed: 'Event Manager access removed: clearance no longer valid',
}

export async function removeEventManager(
  db: SupabaseClient,
  args: { clerkUserId: string; eventSlug: string; reason: RemovalReason; actor: Actor; now?: Date; users?: ClerkUsers; notify?: boolean; routePath?: string },
): Promise<{ ok: true; removed: boolean; role: RoleChange | null } | { ok: false; status: number; error: string }> {
  const now = args.now ?? new Date()
  const { data: row } = await db
    .from(TABLE)
    .select('id, member_id')
    .eq('clerk_user_id', args.clerkUserId)
    .eq('event_slug', args.eventSlug)
    .maybeSingle()
  if (!row) return { ok: true, removed: false, role: null }

  const assignmentTenantId = await loadAssignmentTenantId(db, args.clerkUserId, args.eventSlug)
  const { error } = await db.from(TABLE).delete().eq('id', (row as { id: string }).id)
  if (error) {
    console.error('[event-manager] assignment delete error:', error)
    return { ok: false, status: 500, error: 'Database error' }
  }

  const sync = await syncEventManagerUnassigned(db, args.clerkUserId, args.eventSlug, STELLR_TENANT_ID, assignmentTenantId)
  await reportRoleSyncFailure('event_manager_unassign', sync, { method: 'DELETE', routePath: args.routePath ?? '/lib/event-manager' })
  const role = await clearEventManagerRoleIfUnused(db, args.clerkUserId, args.users, now)

  const memberId = (row as { member_id: string | null }).member_id
  const member = memberId
    ? ((await db.from('members').select('id, first_name, email').eq('id', memberId).maybeSingle()).data as { id: string; first_name: string | null; email: string | null } | null)
    : ((await db.from('members').select('id, first_name, email').eq('clerk_user_id', args.clerkUserId).maybeSingle()).data as { id: string; first_name: string | null; email: string | null } | null)
  const event = (await getEventBySlug(args.eventSlug).catch(() => null)) as { title?: string } | null
  const eventTitle = event?.title ?? args.eventSlug

  // deep review AUTH-6: a revoke is as audit-worthy as a grant.
  await logActivity(
    {
      ...args.actor,
      memberId: member?.id ?? '',
      category: 'account',
      action: 'event_manager_unassigned',
      summary: `${REMOVAL_SUMMARY[args.reason]} for ${eventTitle}`,
      metadata: { event_slug: args.eventSlug, clerk_user_id: args.clerkUserId, reason: args.reason, clerk_role: role, ...roleSyncMetadata(sync) },
    },
    db,
  )

  if (args.notify !== false && member?.email) {
    await sendEmail({ to: member.email, ...eventManagerRemovedEmail({ firstName: member.first_name || 'there', eventTitle, reason: args.reason }) }).catch((err) =>
      console.error('[event-manager] removed email failed:', err),
    )
  }
  return { ok: true, removed: true, role }
}

/**
 * After an admin withdraws someone's clearance: if they are no longer eligible,
 * remove every Event Manager assignment they hold, now. Never throws; returns
 * how many were removed.
 */
export async function recheckEventManagerClearance(db: SupabaseClient, memberId: string, actor: Actor): Promise<number> {
  // Clearance is also a Staff prerequisite: every caller of this is a clearance
  // change, so Staff is re-checked here too (lib/staff.ts). Never throws.
  const { nudgeStaff } = await import('@/lib/staff')
  await nudgeStaff(db, { memberId }, 'clearance_changed')
  try {
    const m = await loadMember(db, { id: memberId })
    if (!m?.clerk_user_id) return 0
    const { data } = await db.from(TABLE).select('event_slug').eq('clerk_user_id', m.clerk_user_id)
    const slugs = ((data ?? []) as { event_slug: string }[]).map((r) => r.event_slug)
    if (slugs.length === 0) return 0
    const now = new Date()
    if (decideEligibility(m, summaryFor(m, now), now).ok) return 0
    let removed = 0
    for (const slug of slugs) {
      const r = await removeEventManager(db, { clerkUserId: m.clerk_user_id, eventSlug: slug, reason: 'clearance_lapsed', actor, now })
      if (r.ok && r.removed) removed++
    }
    return removed
  } catch (err) {
    console.error('[event-manager] clearance recheck failed:', err)
    return 0
  }
}

// ── Daily sweep ─────────────────────────────────────────────────────────────

export interface SweepResult {
  expired: number
  clearanceLapsed: number
  /** Rows granted before the gate (no clearance recorded); listed, not removed. */
  ungated: number
  errors: { clerkUserId: string; eventSlug: string; error: string }[]
}

/**
 * Delete expired assignments, and those whose holder is no longer eligible
 * (clearance lapsed, deactivated, login removed). Rows granted before the gate
 * existed (clearance_basis null) are only counted: removing them unannounced
 * would cut off people an admin chose; the member page flags them instead.
 */
export async function sweepEventManagers(db: SupabaseClient, opts: { now?: Date; users?: ClerkUsers } = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date()
  const actor: Actor = { actorType: 'system', actorLabel: 'Event Manager expiry' }
  const result: SweepResult = { expired: 0, clearanceLapsed: 0, ungated: 0, errors: [] }

  const { data, error } = await db.from(TABLE).select('clerk_user_id, event_slug, expires_at, member_id, clearance_basis')
  if (error) throw new Error(`assignments read failed: ${error.message}`)
  const rows = (data ?? []) as { clerk_user_id: string; event_slug: string; expires_at: string | null; member_id: string | null; clearance_basis: string | null }[]

  const eligibleCache = new Map<string, boolean>()
  for (const r of rows) {
    let reason: RemovalReason | null = null
    if (!isAssignmentActive(r, now)) reason = 'expired'
    else if (!r.clearance_basis) result.ungated++
    else if (r.member_id) {
      if (!eligibleCache.has(r.member_id)) {
        const m = await loadMember(db, { id: r.member_id })
        eligibleCache.set(r.member_id, !!m && m.clerk_user_id === r.clerk_user_id && decideEligibility(m, summaryFor(m, now), now).ok)
      }
      if (!eligibleCache.get(r.member_id)) reason = 'clearance_lapsed'
    }
    if (!reason) continue
    const out = await removeEventManager(db, { clerkUserId: r.clerk_user_id, eventSlug: r.event_slug, reason, actor, now, users: opts.users })
    if (!out.ok) result.errors.push({ clerkUserId: r.clerk_user_id, eventSlug: r.event_slug, error: out.error })
    else if (out.removed && reason === 'expired') result.expired++
    else if (out.removed) result.clearanceLapsed++
  }
  return result
}

// ── Emails ──────────────────────────────────────────────────────────────────

export function eventManagerAssignedEmail({ firstName, eventTitle, expiresOn, url }: { firstName: string; eventTitle: string; expiresOn: string; url: string }) {
  const until = formatDateShort(expiresOn)
  const subject = `You’re an Event Manager for ${eventTitle}`
  const html = emailLayout({
    heading: 'You’re an Event Manager',
    preheader: `Access to ${eventTitle} until ${until}.`,
    bodyHtml: `
        <p>Hi ${esc(firstName)},</p>
        <p>The Stellr team has made you an Event Manager for <strong>${esc(eventTitle)}</strong>. Your access runs until <strong>${esc(until)}</strong>.</p>
        <p>You can now see the event’s roster, check-in and emails. That includes personal information about students, many of them under 18: dates of birth, medical and dietary notes, and emergency contacts.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0 0 8px;font-size:14px;font-weight:600">What we ask of you</p>
          <ul style="margin:0;padding-left:20px;font-size:14px">
            <li>Use this information only to run this event.</li>
            <li>Don’t download, copy or share it beyond what the event needs, and delete any copies once it’s over.</li>
            <li>Contact students only through Stellr and their school, never one-to-one.</li>
            <li>Don’t share your login. Tell us straight away if you think someone else has used it.</li>
          </ul>
        </div>
        <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3C6DF6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Open the event</a></p>
        <p style="color:#6b7280;font-size:14px">Sign in with this email address. If you weren’t expecting this, reply to this email.</p>`,
  })
  const text = `Hi ${firstName},\n\nThe Stellr team has made you an Event Manager for ${eventTitle}. Your access runs until ${until}.\n\nYou can now see the event's roster, check-in and emails. That includes personal information about students, many of them under 18: dates of birth, medical and dietary notes, and emergency contacts.\n\nWhat we ask of you:\n- Use this information only to run this event.\n- Don't download, copy or share it beyond what the event needs, and delete any copies once it's over.\n- Contact students only through Stellr and their school, never one-to-one.\n- Don't share your login. Tell us straight away if you think someone else has used it.\n\nOpen the event: ${url}\n\nSign in with this email address. If you weren't expecting this, reply to this email.\n\n— Stellr Education`
  return { subject, html, text }
}

const REMOVED_LINE: Record<RemovalReason, string> = {
  admin: 'The Stellr team has ended your Event Manager access for',
  expired: 'Your Event Manager access has ended, as planned, for',
  clearance_lapsed: 'Your Event Manager access has ended because your background clearance is no longer valid, for',
}

export function eventManagerRemovedEmail({ firstName, eventTitle, reason }: { firstName: string; eventTitle: string; reason: RemovalReason }) {
  const subject = `Event Manager access ended: ${eventTitle}`
  const html = emailLayout({
    heading: 'Event Manager access ended',
    bodyHtml: `
        <p>Hi ${esc(firstName)},</p>
        <p>${REMOVED_LINE[reason]} <strong>${esc(eventTitle)}</strong>. You can no longer see its roster, check-in or emails.</p>
        <p>Please delete any copies of student information you kept for the event.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email.</p>`,
  })
  const text = `Hi ${firstName},\n\n${REMOVED_LINE[reason]} ${eventTitle}. You can no longer see its roster, check-in or emails.\n\nPlease delete any copies of student information you kept for the event.\n\nQuestions? Reply to this email.\n\n— Stellr Education`
  return { subject, html, text }
}
