import type { SupabaseClient } from '@supabase/supabase-js'
import { isUnder13On, isValidDob } from '@/lib/age'

// The COPPA facts about a member that every login path shares (S0, 2 Nov 2026).
//
// guardedEnsureClerkUser (lib/clerk-provisioning) decides when the app CREATES
// a login. A login can also be made outside the app, by a self-serve Clerk
// sign-up, and then LINKED to a member row found by its email: the Clerk
// webhook and onboarding do that. mayLinkLogin applies the guard's rule there:
// a child under 13, or anyone whose age cannot be read, is linked only once a
// parent or guardian's minor agreement is signed. Kept apart from
// lib/clerk-provisioning so neither linker imports the module that can create
// a Clerk user (lib/clerk-provisioning.guard.test.ts pins who may).

/** The youngest usable date of birth among `dobs` (the latest date), as YYYY-MM-DD, or null. */
export function youngestDob(dobs: Array<string | null | undefined>): string | null {
  const valid = dobs.filter((d): d is string => isValidDob(d)).map((d) => d.slice(0, 10))
  return valid.length ? valid.sort()[valid.length - 1] : null
}

export interface MemberAgeFacts {
  /**
   * The member row's date of birth when it is usable, else the youngest usable
   * one on their participant rows (an existing member who joined through a link
   * keeps a blank member DOB). Null when none is usable.
   */
  dateOfBirth: string | null
  /**
   * The youngest usable date of birth on the member row OR any of their
   * participant rows. For a minor rule a member must not be able to talk their
   * way past (the enrolment gate, onboarding's minor guard): the member row is
   * self-entered at onboarding, so an adult date there does not outrank a
   * minor one a registration put on a participant row (S0, 3 Nov 2026).
   */
  youngestDateOfBirth: string | null
  participantIds: string[]
}

export async function memberAgeFacts(
  db: SupabaseClient,
  member: { id: string; date_of_birth: string | null },
): Promise<MemberAgeFacts> {
  const { data } = await db.from('participants').select('id, date_of_birth').eq('member_id', member.id)
  const parts = (data ?? []) as Array<{ id: string; date_of_birth: string | null }>
  const participantDobs = parts.map((p) => p.date_of_birth)
  return {
    dateOfBirth: isValidDob(member.date_of_birth)
      ? member.date_of_birth.slice(0, 10)
      : youngestDob(participantDobs),
    youngestDateOfBirth: youngestDob([member.date_of_birth, ...participantDobs]),
    participantIds: parts.map((p) => p.id),
  }
}

/**
 * Is a parent or guardian's signed agreement on file for this person? Only a
 * completed `minor` agreement counts — the guardian's consent form, on one of
 * their participant rows or (the membership agreement) on the member. An adult,
 * mentor, volunteer or educator agreement is the signer's own: a child who was
 * once sent one of those to their own email and signed it has given no
 * guardian's consent. A read error counts as "no".
 */
export async function guardianAgreementOnFile(
  db: SupabaseClient,
  who: { memberId?: string | null; participantIds?: string[] },
): Promise<boolean> {
  const scope = [
    who.memberId ? `member_id.eq.${who.memberId}` : null,
    who.participantIds?.length ? `participant_id.in.(${who.participantIds.join(',')})` : null,
  ].filter(Boolean)
  if (scope.length === 0) return false
  const { count, error } = await db
    .from('agreements')
    .select('id', { count: 'exact', head: true })
    .or(scope.join(','))
    .eq('envelope_type', 'minor')
    .eq('status', 'completed')
  if (error) return false
  return (count ?? 0) > 0
}

export type LoginLinkDecision =
  | { allowed: true; basis: 'dob' | 'guardian_agreement' }
  | { allowed: false; reason: 'under_13' | 'age_unknown' }

/**
 * May a login made outside the app be tied to this member row? The guard's
 * rule, judged on today's date: 13 or over by date of birth, or a guardian's
 * agreement on file. `alsoDob` is a date of birth the person has just given
 * (onboarding); the younger reading wins, so typing an older one changes
 * nothing. A member of null is someone with no row yet: only their own answer
 * counts, and no agreement can be on file.
 */
export async function mayLinkLogin(
  db: SupabaseClient,
  member: { id: string; date_of_birth: string | null } | null,
  alsoDob?: string | null,
): Promise<LoginLinkDecision> {
  const facts = member ? await memberAgeFacts(db, member) : { dateOfBirth: null, participantIds: [] }
  const dob = youngestDob([facts.dateOfBirth, alsoDob])
  if (!isUnder13On(dob)) return { allowed: true, basis: 'dob' }
  if (member) {
    const onFile = await guardianAgreementOnFile(db, { memberId: member.id, participantIds: facts.participantIds })
      .catch(() => false)
    if (onFile) return { allowed: true, basis: 'guardian_agreement' }
  }
  return { allowed: false, reason: dob ? 'under_13' : 'age_unknown' }
}
