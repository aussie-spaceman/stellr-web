// Volunteer program helpers (PRD §15 — Volunteer Registration / Event Sign Up).
//
// One place that knows what "being a volunteer" means operationally:
//   • the additive 'volunteer' role in member_roles (admin-toggleable, and synced
//     from event_role='volunteer' at onboarding)
//   • membership of the Volunteer Space (resources + mandatory training live there)
//   • the Volunteer Agreement (a DocuSign envelope_type='volunteer', valid 3 years,
//     recorded against the program rather than a specific event)
//   • per-event support interest (volunteer_event_interest), which admins convert
//     into a roster assignment manually.
//
// All writes are service-role; callers pass their request's db client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { addGlobalRole, memberHasRole } from '@/lib/member-roles'
import { applyGrantTrigger } from '@/lib/membership-grants'
import { dispatchAgreement, agreementExpiry, coveringTypes, type DispatchOutcome } from '@/lib/docusign-agreements'
import { deriveCompliance, loadComplianceRecordsByEmails, type ComplianceState } from '@/lib/compliance'
import { logActivity, type Actor } from '@/lib/activity-log'

/** Slug of the community space that acts as the Volunteer Hub (created via the
 *  admin Spaces UI; role grants no-op gracefully until it exists). */
const VOLUNTEER_SPACE_SLUG = process.env.VOLUNTEER_SPACE_SLUG ?? 'volunteer-hub'

// Program-level context the Volunteer Agreement is recorded under. Not an event:
// the agreement covers all volunteer activity for its 3-year validity window.
const VOLUNTEER_PROGRAM_SLUG = 'volunteer-program'
export const VOLUNTEER_PROGRAM_TITLE = 'Stellr Volunteer Program'

export async function isVolunteer(memberId: string): Promise<boolean> {
  return memberHasRole(memberId, 'volunteer')
}

/**
 * Ensure the member is on the Volunteer Space roster (active, base member role).
 * No-op when the space hasn't been created yet — the hub is configuration, not a
 * schema dependency.
 */
async function addToVolunteerSpace(db: SupabaseClient, memberId: string): Promise<void> {
  const { data: space } = await db
    .from('community_spaces')
    .select('id')
    .eq('slug', VOLUNTEER_SPACE_SLUG)
    .maybeSingle()
  if (!space) return

  const { error } = await db
    .from('community_space_members')
    .upsert(
      { space_id: space.id, member_id: memberId, role: 'member', status: 'active' },
      { onConflict: 'space_id,member_id', ignoreDuplicates: true },
    )
  if (error) console.error('[volunteer] space roster upsert error (non-fatal):', error)
}

async function removeFromVolunteerSpace(db: SupabaseClient, memberId: string): Promise<void> {
  const { data: space } = await db
    .from('community_spaces')
    .select('id')
    .eq('slug', VOLUNTEER_SPACE_SLUG)
    .maybeSingle()
  if (!space) return
  await db
    .from('community_space_members')
    .delete()
    .eq('space_id', space.id)
    .eq('member_id', memberId)
}

/**
 * Make a member a volunteer: additive member_roles grant + Volunteer Space roster.
 * Idempotent. Used by volunteer onboarding (source 'registration') and the admin
 * toggle (source 'admin').
 */
export async function grantVolunteerRole(
  db: SupabaseClient,
  memberId: string,
  actor: Actor,
  source: 'registration' | 'admin' = 'admin',
): Promise<void> {
  const already = await memberHasRole(memberId, 'volunteer')
  await addGlobalRole(db, memberId, 'volunteer', source)
  await addToVolunteerSpace(db, memberId)
  if (!already) {
    // Fire any 'volunteer_registration' grant rules (e.g. college volunteers →
    // Contributor). Only on first grant so repeat saves don't re-trigger.
    await applyGrantTrigger(memberId, 'volunteer_registration', {}, db)
    await logActivity({
      memberId,
      category: 'account',
      action: 'volunteer_role_granted',
      summary: 'Added to the volunteer program',
      metadata: { source },
      ...actor,
    }, db)
  }
}

/** Remove the volunteer role and Volunteer Space membership. Idempotent. */
export async function revokeVolunteerRole(
  db: SupabaseClient,
  memberId: string,
  actor: Actor,
): Promise<void> {
  const had = await memberHasRole(memberId, 'volunteer')
  await db
    .from('member_roles')
    .delete()
    .eq('member_id', memberId)
    .eq('role', 'volunteer')
    .eq('scope', 'global')
  await removeFromVolunteerSpace(db, memberId)
  if (had) {
    await logActivity({
      memberId,
      category: 'account',
      action: 'volunteer_role_revoked',
      summary: 'Removed from the volunteer program',
      ...actor,
    }, db)
  }
}

export interface VolunteerMemberRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
}

/**
 * Issue (or reuse) the Volunteer Agreement for a member, recorded against the
 * program context. dispatchAgreement handles the 3-year on-file reuse and is
 * non-fatal on DocuSign outages. Unless `force` (admin re-issue), an envelope
 * already in flight (sent/delivered) is left alone so repeat onboarding saves
 * and repeat event assignments can't double-issue. A mentor envelope counts:
 * it is the same document (coveringTypes).
 */
export async function dispatchVolunteerAgreement(
  db: SupabaseClient,
  member: VolunteerMemberRow,
  opts: { force?: boolean } = {},
): Promise<DispatchOutcome | 'no_email'> {
  if (!member.email) return 'no_email'
  if (!opts.force) {
    const { data: inFlight } = await db
      .from('agreements')
      .select('id')
      .eq('member_id', member.id)
      .in('envelope_type', coveringTypes('volunteer'))
      .in('status', ['created', 'sent', 'delivered'])
      .limit(1)
      .maybeSingle()
    if (inFlight) return 'in_flight'
  }
  return dispatchAgreement(db, {
    participantId: null,
    memberId:      member.id,
    eventSlug:     VOLUNTEER_PROGRAM_SLUG,
    eventTitle:    VOLUNTEER_PROGRAM_TITLE,
    firstName:     member.first_name ?? '',
    lastName:      member.last_name ?? '',
    email:         member.email,
    phone:         member.phone,
    dateOfBirth:   member.date_of_birth,
    eventRole:     'volunteer',
  })
}

// ─── Status derivation (admin console + event Volunteers panel) ──────────────

export type VolunteerAgreementStatus = 'complete' | 'in_flight' | 'missing'

export interface VolunteerStatus {
  agreement: VolunteerAgreementStatus
  compliance: ComplianceState
  complianceDetail: string | null
}

/**
 * Per-member Volunteer Agreement + background-check status, batched. Advisory
 * only — volunteer assignment is warn-don't-block, so callers render pills and
 * never gate on these.
 */
export async function getVolunteerStatuses(
  db: SupabaseClient,
  members: Array<{ id: string; email: string | null; date_of_birth: string | null }>,
): Promise<Record<string, VolunteerStatus>> {
  const out: Record<string, VolunteerStatus> = {}
  if (members.length === 0) return out

  const ids = members.map((m) => m.id)
  const [{ data: envelopes }, compliance] = await Promise.all([
    db
      .from('agreements')
      .select('member_id, status, completed_at')
      .in('member_id', ids)
      .in('envelope_type', coveringTypes('volunteer')),
    loadComplianceRecordsByEmails(db, members.map((m) => m.email ?? '')),
  ])

  const now = new Date()
  for (const m of members) {
    const mine = (envelopes ?? []).filter((e) => e.member_id === m.id)
    const complete = mine.some(
      (e) => e.status === 'completed' && e.completed_at && agreementExpiry(e.completed_at) > now,
    )
    const inFlight = mine.some((e) => ['created', 'sent', 'delivered'].includes(e.status))
    const records = compliance.get((m.email ?? '').toLowerCase())
    const summary = deriveCompliance(
      records?.license ?? null,
      records?.checks ?? [],
      'volunteer',
      m.date_of_birth,
    )
    out[m.id] = {
      agreement: complete ? 'complete' : inFlight ? 'in_flight' : 'missing',
      compliance: summary.state,
      complianceDetail: summary.detail,
    }
  }
  return out
}

export interface VolunteerTrainingProgress {
  completed: number
  total: number
}

/**
 * Mandatory volunteer-training completion per member: published lessons across
 * the courses linked to the Volunteer Space (community_space_training,
 * is_mandatory only). total=0 means no mandatory course is configured yet.
 */
export async function getVolunteerTrainingProgress(
  db: SupabaseClient,
  memberIds: string[],
): Promise<Record<string, VolunteerTrainingProgress>> {
  const out: Record<string, VolunteerTrainingProgress> = {}
  for (const id of memberIds) out[id] = { completed: 0, total: 0 }
  if (memberIds.length === 0) return out

  const { data: space } = await db
    .from('community_spaces')
    .select('id')
    .eq('slug', VOLUNTEER_SPACE_SLUG)
    .maybeSingle()
  if (!space) return out

  const { data: links } = await db
    .from('community_space_training')
    .select('training_module_id')
    .eq('space_id', space.id)
    .eq('is_mandatory', true)
  const moduleIds = (links ?? []).map((l) => l.training_module_id as string)
  if (moduleIds.length === 0) return out

  const { data: items } = await db
    .from('training_items')
    .select('id')
    .in('module_id', moduleIds)
    .eq('status', 'published')
  const itemIds = (items ?? []).map((i) => i.id as string)
  if (itemIds.length === 0) return out

  const { data: progress } = await db
    .from('training_progress')
    .select('member_id, item_id')
    .in('member_id', memberIds)
    .in('item_id', itemIds)
    .eq('status', 'completed')

  for (const id of memberIds) out[id] = { completed: 0, total: itemIds.length }
  for (const p of progress ?? []) {
    const row = out[p.member_id as string]
    if (row) row.completed += 1
  }
  return out
}

/** A volunteer's current (non-withdrawn) event-support interests. */
export async function getVolunteerInterests(
  db: SupabaseClient,
  memberId: string,
): Promise<Array<{ event_slug: string; event_title: string; created_at: string }>> {
  const { data } = await db
    .from('volunteer_event_interest')
    .select('event_slug, event_title, created_at')
    .eq('member_id', memberId)
    .eq('status', 'interested')
    .order('created_at', { ascending: false })
  return data ?? []
}

export interface VolunteerAgreementRecord {
  id: string
  status: string
  event_title: string
  sent_at: string | null
  completed_at: string | null
  reused_from: string | null
  signers_total: number | null
  signers_completed: number | null
  /** Completed only: when the 3-year validity ends. */
  expires_at: string | null
}

/**
 * The one envelope that answers "does this member have a Volunteer Agreement?"
 * for the admin member page: the newest unexpired signed one, else the newest
 * in flight, else the newest of any kind (declined / voided / expired), else
 * null. Mentor envelopes count — same document (coveringTypes).
 */
export function pickVolunteerAgreement<T extends Omit<VolunteerAgreementRecord, 'expires_at'>>(
  rows: T[],
  now: Date = new Date(),
): (T & { expires_at: string | null }) | null {
  const newest = (xs: T[]) =>
    [...xs].sort((a, b) =>
      (b.completed_at ?? b.sent_at ?? '').localeCompare(a.completed_at ?? a.sent_at ?? ''),
    )[0]
  const withExpiry = (r: T | undefined) =>
    r ? { ...r, expires_at: r.completed_at ? agreementExpiry(r.completed_at).toISOString() : null } : null

  const valid = rows.filter(
    (r) => r.status === 'completed' && r.completed_at && agreementExpiry(r.completed_at) > now,
  )
  if (valid.length) return withExpiry(newest(valid))
  const open = rows.filter((r) => ['created', 'sent', 'delivered'].includes(r.status))
  if (open.length) return withExpiry(newest(open))
  return withExpiry(newest(rows))
}

export async function loadVolunteerAgreement(
  db: SupabaseClient,
  memberId: string,
): Promise<VolunteerAgreementRecord | null> {
  const { data } = await db
    .from('agreements')
    .select('id, status, event_title, sent_at, completed_at, reused_from, signers_total, signers_completed')
    .eq('member_id', memberId)
    .in('envelope_type', coveringTypes('volunteer'))
  return pickVolunteerAgreement(data ?? [])
}
