import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureClerkUser } from '@/lib/clerk-provisioning'
import { accountInviteEmail, groupAccountCreatedEmail, sendEmail } from '@/lib/email'
import { AUTH_APP_URL } from '@/lib/env'
import { logActivity } from '@/lib/activity-log'
import { isUnder13On } from '@/lib/age'

// A double-click or an impatient admin should not put two invites in an inbox.
export const ACCOUNT_INVITE_COOLDOWN_MS = 10 * 60 * 1000

export type AccountInviteResult =
  | { sent: true }
  | { sent: false; reason: 'not_found' | 'complete' | 'cooldown' | 'send_failed' }

/**
 * Email a hand-created member an "activate your account" link to
 * /account/onboarding, where they supply what the admin could not (DOB, gender,
 * phone). Before sending, make sure a passwordless Clerk login exists for their
 * email and is linked to the row — the Clerk webhook would link it too, but
 * doing it here means the invite works even if public sign-up is closed.
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
    .select('id, first_name, last_name, email, clerk_user_id, date_of_birth, gender, account_invite_sent_at')
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
    try {
      const { clerkUserId } = await ensureClerkUser(member.email, member.first_name ?? '', member.last_name ?? '')
      // Only link if nothing else has in the meantime (e.g. the webhook).
      await db.from('members').update({ clerk_user_id: clerkUserId }).eq('id', member.id).is('clerk_user_id', null)
    } catch (e) {
      // Still send: without a pre-made login the link falls back to sign-in,
      // which offers sign-up, and the webhook links the account by email.
      console.error('[member-invite] Clerk provisioning failed (continuing):', e)
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
 *
 * Never throws: the registration already exists; the result says what happened.
 */
export async function sendGroupAccountInvite(
  db: SupabaseClient,
  memberId: string,
  { eventTitle, organiserName }: { eventTitle: string; organiserName: string },
): Promise<GroupAccountInviteResult> {
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, clerk_user_id, date_of_birth, account_invite_sent_at, is_active, deleted_at')
    .eq('id', memberId)
    .maybeSingle()
  if (!member?.email || member.deleted_at || member.is_active === false) return { sent: false, reason: 'not_found' }
  if (member.clerk_user_id) return { sent: false, reason: 'has_account' }
  if (member.account_invite_sent_at) return { sent: false, reason: 'already_invited' }

  if (isUnder13On(member.date_of_birth) && !(await hasCompletedAgreement(db, member.id))) {
    return { sent: false, reason: 'awaiting_consent' }
  }

  try {
    const { clerkUserId } = await ensureClerkUser(member.email, member.first_name ?? '', member.last_name ?? '')
    await db.from('members').update({ clerk_user_id: clerkUserId }).eq('id', member.id).is('clerk_user_id', null)
  } catch (e) {
    // Still send: sign-in offers sign-up, and the Clerk webhook links by email.
    console.error('[member-invite] group Clerk provisioning failed (continuing):', e)
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
    action: 'group_account_created',
    summary: `Account created from a group registration (${eventTitle}); sign-in email sent to ${member.email}`,
  }, db)
  return { sent: true }
}

async function hasCompletedAgreement(db: SupabaseClient, memberId: string): Promise<boolean> {
  const { data: parts } = await db.from('participants').select('id').eq('member_id', memberId)
  const ids = (parts ?? []).map((p) => (p as { id: string }).id)
  if (ids.length === 0) return false
  const { count } = await db
    .from('agreements')
    .select('id', { count: 'exact', head: true })
    .in('participant_id', ids)
    .eq('status', 'completed')
  return (count ?? 0) > 0
}
