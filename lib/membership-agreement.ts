import type { SupabaseClient } from '@supabase/supabase-js'
import { isMinorOn } from '@/lib/age'
import { denormalizeGrade, normalizeEmail } from '@/lib/member-enums'
import { agreementValid, dispatchTyped, type DispatchResult } from '@/lib/docusign-agreements'
import { holderMinorFacts } from '@/lib/credentials'
import { isMinorPerPolicy } from '@/lib/minor-policy'
import { GUARDIAN_RELATIONSHIPS } from '@/lib/pending-consent'
import type { MembershipPlanParams } from '@/lib/esign/native/plan'

// The Membership Agreement, for people who join Stellr without first attending
// an event (self-serve sign-up, an admin invite, /join). Always issued on
// Stellr signing: it never spends a DocuSign envelope. An adult signs it
// themselves; for a Minor, their parent or guardian signs first and then the
// member. A Minor signs the Student / Minor agreement (V2.3), which covers
// membership and every event, and is recorded as one. "Minor" is the policy's
// (Privacy Policy §2; legal-credential-family-link.7), read the way credentials
// read it (holderMinorFacts + isMinorPerPolicy): under the age of majority in
// their school's state, or still in school. Until 14 Nov 2026 this was under 18
// alone, so an 18-year-old in Nebraska or still in high school signed the adult
// document and their credential pages could never go public.
//
// Defaults agreed in the plan (docs/PLAN-esign-2026-10-02.md §7):
//  • not issued while a valid signed event agreement is on file;
//  • it never stands in for event paperwork;
//  • volunteers sign the mentor agreement instead.

/** Recorded against this pseudo-event, like the volunteer program's agreement. */
export const MEMBERSHIP_SLUG = 'membership'
export const MEMBERSHIP_TITLE = 'Stellr Education membership'

const COVERING_TYPES = ['minor', 'adult', 'mentor', 'volunteer', 'membership']

interface MemberForAgreement {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  grade: string | null
  ec_first_name: string | null
  ec_last_name: string | null
  ec_email: string | null
  ec_phone: string | null
  ec_relationship: string | null
}

const MEMBER_COLUMNS =
  'id, first_name, last_name, email, phone, date_of_birth, grade, ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship'

/** A signed agreement of any kind that is still valid under its own terms. */
async function agreementOnFile(db: SupabaseClient, memberId: string, now = new Date()): Promise<boolean> {
  const { data } = await db
    .from('agreements')
    .select('completed_at, envelope_type, agreement_version')
    .eq('member_id', memberId)
    .eq('status', 'completed')
    .in('envelope_type', COVERING_TYPES)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as { completed_at: string | null; envelope_type: string; agreement_version: string | null } | null
  return !!row && agreementValid(row, now)
}

/** Any agreement out for signature for this member: paperwork is already on its way. */
async function agreementInFlight(db: SupabaseClient, memberId: string): Promise<boolean> {
  const { data } = await db
    .from('agreements')
    .select('id')
    .eq('member_id', memberId)
    .in('envelope_type', COVERING_TYPES)
    .in('status', ['created', 'sent', 'delivered'])
    .limit(1)
    .maybeSingle()
  return !!data
}

export async function dispatchMembershipAgreement(db: SupabaseClient, memberId: string): Promise<DispatchResult> {
  const { data } = await db.from('members').select(MEMBER_COLUMNS).eq('id', memberId).maybeSingle()
  const member = data as MemberForAgreement | null
  if (!member?.email) return { outcome: 'not_required' }
  if (await agreementOnFile(db, member.id)) return { outcome: 'on_file' }
  if (await agreementInFlight(db, member.id)) return { outcome: 'in_flight' }

  const { minor, state } = await membershipMinor(db, member)
  const guardianName = [member.ec_first_name, member.ec_last_name].filter(Boolean).join(' ').trim()
  if (minor && !hasGuardianContact(member, guardianName)) {
    // A Minor's emergency contact signs first, as their parent or guardian, so
    // it has to be one: a Parent or Legal Guardian, with a name and an email
    // that is not the member's own. Onboarding insists on that only for an
    // under-18 registering themselves; an 18-to-20-year-old who is a Minor by
    // their state, or a student 18 or over, may have given a partner, sibling
    // or friend, who must not be sent the member's agreement to sign as their
    // guardian. Nothing is issued until staff record the guardian (members.id
    // only in the log).
    console.warn(`[membership] member ${member.id} is a Minor with no parent or guardian contact on file; agreement not issued`)
    return { outcome: 'not_required' }
  }

  // The member's state rides along so the native plan applies the same rule
  // (lib/esign/native/plan, MembershipPlanParams).
  const membership: Omit<MembershipPlanParams, 'firstName' | 'lastName' | 'email' | 'phone'> = {
    memberId: member.id,
    dateOfBirth: member.date_of_birth ?? undefined,
    ...(state ? { state } : {}),
    ...(minor
      ? {
          grade: member.grade ? (denormalizeGrade(member.grade) ?? member.grade) : undefined,
          guardianName,
          guardianEmail: member.ec_email ?? undefined,
          guardianPhone: member.ec_phone ?? undefined,
          relationship: member.ec_relationship ?? undefined,
        }
      : {}),
  }

  return dispatchTyped(
    db,
    {
      participantId: null,
      memberId: member.id,
      eventSlug: MEMBERSHIP_SLUG,
      eventTitle: MEMBERSHIP_TITLE,
      firstName: member.first_name ?? '',
      lastName: member.last_name ?? '',
      email: member.email,
      phone: member.phone,
      dateOfBirth: member.date_of_birth,
    },
    'membership',
    membership,
  )
}

/**
 * Whether the member's emergency contact can sign as their parent or guardian:
 * a Parent or Legal Guardian (lib/pending-consent, the rule onboarding applies
 * to a self-registered under-18), with a name and an email that differs from
 * the member's own.
 */
function hasGuardianContact(
  member: Pick<MemberForAgreement, 'email' | 'ec_email' | 'ec_relationship'>,
  guardianName: string,
): boolean {
  if (!guardianName || !member.ec_email) return false
  if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(String(member.ec_relationship ?? '').trim())) return false
  const own = normalizeEmail(member.email)
  return !own || normalizeEmail(member.ec_email) !== own
}

/**
 * Whether the member signs as a Minor, and their school's state, read as
 * credentials read them (holderMinorFacts: with a date of birth known, a grade
 * or bracket from an earlier school year counts as unknown). If the records cannot be read, under 18 by
 * the date of birth decides, with an unknown date presumed a Minor, as before.
 */
export async function membershipMinor(
  db: SupabaseClient,
  member: Pick<MemberForAgreement, 'id' | 'date_of_birth'>,
): Promise<{ minor: boolean; state: string | null }> {
  const facts = await holderMinorFacts(db, { memberId: member.id, participantId: null }, { dateOfBirth: member.date_of_birth })
  if (!facts) return { minor: isMinorOn(member.date_of_birth), state: null }
  return {
    minor: isMinorPerPolicy({ ...facts, dateOfBirth: member.date_of_birth ?? facts.dateOfBirth }),
    state: facts.state ?? null,
  }
}

/** Whether this member still owes the membership agreement: nothing signed, nothing in flight. */
export async function membershipAgreementOutstanding(db: SupabaseClient, memberId: string): Promise<boolean> {
  return !(await agreementOnFile(db, memberId)) && !(await agreementInFlight(db, memberId))
}

/**
 * Whether the member area is held until the agreement is signed. Off unless
 * MEMBERSHIP_AGREEMENT_ENFORCE is 'true': what is blocked, and from when, is
 * the owner's decision (plan, Phase 3). Until then the gate only reports.
 */
export function membershipAgreementEnforced(): boolean {
  return process.env.MEMBERSHIP_AGREEMENT_ENFORCE === 'true'
}

export type MembershipGate =
  | { state: 'clear' }
  /** Out for signature: the member can sign from their account page. */
  | { state: 'awaiting_signature' }
  /** Nothing signed and nothing sent. */
  | { state: 'not_issued' }

/**
 * The gate for one member. Volunteers sign the mentor agreement instead, and
 * a member still onboarding has not been asked yet: both are clear.
 */
export async function membershipGate(db: SupabaseClient, memberId: string): Promise<MembershipGate> {
  const { data } = await db.from('members').select('date_of_birth, event_role').eq('id', memberId).maybeSingle()
  if (!data?.date_of_birth || data.event_role === 'volunteer') return { state: 'clear' }
  if (await agreementOnFile(db, memberId)) return { state: 'clear' }
  return (await agreementInFlight(db, memberId)) ? { state: 'awaiting_signature' } : { state: 'not_issued' }
}
