import type { SupabaseClient } from '@supabase/supabase-js'
import { isMinorOn } from '@/lib/age'
import { agreementExpiry, dispatchTyped, type DispatchResult } from '@/lib/docusign-agreements'

// The Membership Agreement, for people who join Stellr without first attending
// an event (self-serve sign-up, an admin invite, /join). Always issued on
// Stellr signing: it never spends a DocuSign envelope. An adult signs it
// themselves; for an under-18, their parent or guardian signs first and then
// the member.
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
  ec_first_name: string | null
  ec_last_name: string | null
  ec_email: string | null
  ec_phone: string | null
  ec_relationship: string | null
}

const MEMBER_COLUMNS =
  'id, first_name, last_name, email, phone, date_of_birth, ec_first_name, ec_last_name, ec_email, ec_phone, ec_relationship'

/** A signed agreement of any kind, still within its three-year validity. */
async function agreementOnFile(db: SupabaseClient, memberId: string, now = new Date()): Promise<boolean> {
  const { data } = await db
    .from('agreements')
    .select('completed_at')
    .eq('member_id', memberId)
    .eq('status', 'completed')
    .in('envelope_type', COVERING_TYPES)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const completedAt = (data as { completed_at?: string | null } | null)?.completed_at
  return !!completedAt && agreementExpiry(completedAt) > now
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

  const minor = isMinorOn(member.date_of_birth)
  const guardianName = [member.ec_first_name, member.ec_last_name].filter(Boolean).join(' ').trim()
  if (minor && (!member.ec_email || !guardianName)) {
    // Onboarding requires the guardian's details for an under-18, so this is
    // a record created another way. Nothing can be issued without them.
    return { outcome: 'not_required' }
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
    {
      memberId: member.id,
      dateOfBirth: member.date_of_birth ?? undefined,
      ...(minor
        ? {
            guardianName,
            guardianEmail: member.ec_email ?? undefined,
            guardianPhone: member.ec_phone ?? undefined,
            relationship: member.ec_relationship ?? undefined,
          }
        : {}),
    },
  )
}

/** Whether this member still owes the membership agreement: nothing signed, nothing in flight. */
export async function membershipAgreementOutstanding(db: SupabaseClient, memberId: string): Promise<boolean> {
  return !(await agreementOnFile(db, memberId)) && !(await agreementInFlight(db, memberId))
}
