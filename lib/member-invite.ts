import type { SupabaseClient } from '@supabase/supabase-js'
import { guardedEnsureClerkUser, type GuardedClerkUser } from '@/lib/clerk-provisioning'
import { accountInviteEmail, groupAccountCreatedEmail, sendEmail } from '@/lib/email'
import { AUTH_APP_URL } from '@/lib/env'
import { logActivity } from '@/lib/activity-log'
import { guardianAgreementOnFile, memberAgeFacts } from '@/lib/guardian-consent'

// A double-click or an impatient admin should not put two invites in an inbox.
export const ACCOUNT_INVITE_COOLDOWN_MS = 10 * 60 * 1000

export type AccountInviteResult =
  | { sent: true }
  | {
      sent: false
      reason: 'not_found' | 'complete' | 'cooldown' | 'send_failed' | 'awaiting_consent' | 'age_unknown'
    }

// An admin's record of an adult, for a hand-created member with no date of
// birth yet (S0, 2 Nov 2026): an adult age bracket AND an adult role. A
// subscriber is not enough — it is also what a bare self-signup gets.
const ADULT_BRACKETS = new Set(['adult', 'college'])
const ADULT_ROLES = new Set(['teacher', 'mentor', 'parent', 'adult', 'volunteer'])

/** Did an admin record this member as an adult (bracket and role)? */
export function isAdultByRole(m: { age_bracket?: string | null; event_role?: string | null }): boolean {
  return ADULT_BRACKETS.has(m.age_bracket ?? '') && ADULT_ROLES.has(m.event_role ?? '')
}

/**
 * Email a hand-created member an "activate your account" link to
 * /account/onboarding, where they supply what the admin could not (DOB, gender,
 * phone). Before sending, make sure a passwordless Clerk login exists for their
 * email and is linked to the row — the Clerk webhook would link it too, but
 * doing it here means the invite works even if public sign-up is closed.
 *
 * The login goes through the COPPA guard (lib/clerk-provisioning): a child
 * under 13 waits for a parent or guardian's agreement ('awaiting_consent'),
 * and nothing is emailed. Someone with no date of birth on file gets a login
 * only when the admin recorded them as an adult (isAdultByRole), which is
 * logged; otherwise the admin is asked for a date of birth ('age_unknown').
 *
 * Never throws: the caller has already created the member, and a failed invite
 * must not turn that into an error. The result says what happened.
 */
export async function sendAccountInvite(
  db: SupabaseClient,
  memberId: string,
  { actorMemberId, force = false }: { actorMemberId?: string | null; force?: boolean } = {},
): Promise<AccountInviteResult> {
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, clerk_user_id, date_of_birth, gender, age_bracket, event_role, account_invite_sent_at')
    .eq('id', memberId)
    .maybeSingle()
  if (!member?.email) return { sent: false, reason: 'not_found' }

  // Nothing left for them to complete — they have already onboarded.
  if (member.date_of_birth && member.gender) return { sent: false, reason: 'complete' }

  if (
    !force &&
    member.account_invite_sent_at &&
    Date.now() - new Date(member.account_invite_sent_at).getTime() < ACCOUNT_INVITE_COOLDOWN_MS
  ) {
    return { sent: false, reason: 'cooldown' }
  }

  if (!member.clerk_user_id) {
    let login: GuardedClerkUser | null = null
    try {
      login = await guardedEnsureClerkUser(member.email, member.first_name ?? '', member.last_name ?? '', {
        dateOfBirth: member.date_of_birth,
        guardianAgreementOnFile: async () => guardianAgreementOnFile(db, {
          memberId: member.id,
          participantIds: (await memberAgeFacts(db, member)).participantIds,
        }),
        adultByRole: isAdultByRole(member),
      })
    } catch (e) {
      // A Clerk failure, after the age check passed (a refusal is returned, not
      // thrown). Still send: without a pre-made login the link falls back to
      // sign-in, which offers sign-up, and the webhook links the account by email.
      console.error('[member-invite] Clerk provisioning failed (continuing):', e)
    }
    if (login && !login.allowed) {
      return { sent: false, reason: login.reason === 'under_13' ? 'awaiting_consent' : 'age_unknown' }
    }
    if (login?.allowed) {
      // Only link if nothing else has in the meantime (e.g. the webhook).
      await db.from('members').update({ clerk_user_id: login.clerkUserId }).eq('id', member.id).is('clerk_user_id', null)
      if (login.basis === 'adult_by_role') {
        await logActivity({
          memberId: member.id,
          category: 'account',
          actorType: 'admin',
          actorMemberId: actorMemberId ?? null,
          action: 'account_login_adult_by_role',
          summary: `Login created with no date of birth on file: recorded as an adult (${member.event_role}, ${member.age_bracket}) by an admin`,
        }, db)
      }
    }
  }

  const mail = accountInviteEmail({
    firstName: member.first_name || 'there',
    email: member.email,
    url: `${AUTH_APP_URL}/account/onboarding`,
  })
  try {
    await sendEmail({ to: member.email, ...mail })
  } catch (e) {
    console.error('[member-invite] send failed:', e)
    return { sent: false, reason: 'send_failed' }
  }

  await db.from('members').update({ account_invite_sent_at: new Date().toISOString() }).eq('id', member.id)
  await logActivity({
    memberId: member.id,
    category: 'account',
    actorType: 'admin',
    actorMemberId: actorMemberId ?? null,
    action: 'account_invite_sent',
    summary: `Account invite emailed to ${member.email}`,
  }, db)

  return { sent: true }
}

export type GroupAccountInviteResult =
  | { sent: true }
  | { sent: false; reason: 'not_found' | 'has_account' | 'already_invited' | 'awaiting_consent' | 'send_failed' }

/**
 * Create the login for someone a teacher registered in a group, and tell them.
 * Their member record already holds what the teacher entered, so unlike
 * sendAccountInvite this sends even when the profile is complete: the email
 * says "your account exists — sign in and check your details".
 *
 * Sent once per member (account_invite_sent_at). Skipped for anyone who already
 * has a login. A child under 13 is not emailed until a parent or guardian has
 * signed their consent form — the privacy policy promises consent comes first —
 * so the daily sweep (lib/group-account-invites) picks them up after signing.
 * The COPPA guard (lib/clerk-provisioning) makes that call. Age comes from the
 * member row, or, when that has no usable date of birth (an existing member
 * who joined through a link), from their participant rows, the youngest one.
 *
 * With no organiserName it is for someone who registered themselves (an
 * individual registrant, or a group's student organiser) and was refused a
 * login at registration for being under 13: the sweep sends it once their
 * parent or guardian has signed, and the email names no organiser.
 *
 * Never throws: the registration already exists; the result says what happened.
 */
export async function sendGroupAccountInvite(
  db: SupabaseClient,
  memberId: string,
  { eventTitle, organiserName }: { eventTitle: string; organiserName?: string | null },
): Promise<GroupAccountInviteResult> {
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, clerk_user_id, date_of_birth, account_invite_sent_at, is_active, deleted_at')
    .eq('id', memberId)
    .maybeSingle()
  if (!member?.email || member.deleted_at || member.is_active === false) return { sent: false, reason: 'not_found' }
  if (member.clerk_user_id) return { sent: false, reason: 'has_account' }
  if (member.account_invite_sent_at) return { sent: false, reason: 'already_invited' }

  const { dateOfBirth, participantIds } = await memberAgeFacts(db, member)

  let login: GuardedClerkUser | null = null
  try {
    login = await guardedEnsureClerkUser(member.email, member.first_name ?? '', member.last_name ?? '', {
      dateOfBirth,
      guardianAgreementOnFile: () => guardianAgreementOnFile(db, { memberId: member.id, participantIds }),
    })
  } catch (e) {
    // A Clerk failure, after the age check passed. Still send: sign-in offers
    // sign-up, and the Clerk webhook links by email.
    console.error('[member-invite] group Clerk provisioning failed (continuing):', e)
  }
  if (login && !login.allowed) return { sent: false, reason: 'awaiting_consent' }
  if (login?.allowed) {
    await db.from('members').update({ clerk_user_id: login.clerkUserId }).eq('id', member.id).is('clerk_user_id', null)
  }

  const mail = groupAccountCreatedEmail({
    firstName: member.first_name || 'there',
    email: member.email,
    eventTitle,
    organiserName,
    url: `${AUTH_APP_URL}/account/onboarding?next=${encodeURIComponent('/account?tab=profile')}`,
  })
  try {
    await sendEmail({ to: member.email, ...mail })
  } catch (e) {
    console.error('[member-invite] group send failed:', e)
    return { sent: false, reason: 'send_failed' }
  }

  await db.from('members').update({ account_invite_sent_at: new Date().toISOString() }).eq('id', member.id)
  await logActivity({
    memberId: member.id,
    category: 'account',
    actorType: 'system',
    action: organiserName ? 'group_account_created' : 'registration_account_created',
    summary: organiserName
      ? `Account created from a group registration (${eventTitle}); sign-in email sent to ${member.email}`
      : `Account created after a registration held for consent (${eventTitle}); sign-in email sent to ${member.email}`,
  }, db)
  return { sent: true }
}
