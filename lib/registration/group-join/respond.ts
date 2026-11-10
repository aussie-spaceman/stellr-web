import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, groupMemberJoinedEmail } from '@/lib/email'
import { ensureIndividualPayments } from '@/lib/individual-payment'
import type { ConfirmedJoinLink } from './gate'
import type { GroupJoiner } from './identify'

/** POST /api/register/group-join, the last step: tell the organiser, then what is owed, then the answer. */
export async function respondToGroupJoin(
  db: SupabaseClient,
  link: ConfirmedJoinLink,
  joiner: GroupJoiner,
  participantId: string,
): Promise<Response> {
  const { reg, registrationId, eventSlug, eventTitle } = link
  const { person, signInToken } = joiner

  // S5 A7: on a tenant's event the organiser's notice would go from Stellr's sender,
  // and seats paid one by one would reach Stellr's Stripe account, so neither runs.
  // The person joining had the tenant's confirmation in the hooks.
  if (!link.context.isPlatformOwner) {
    return NextResponse.json({ success: true, eventSlug, eventTitle, signInToken: null }, { status: 201 })
  }

  // Count total members who have completed their join
  const { count: joinedCount } = await db
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('registration_id', registrationId)
    .not('join_completed_at', 'is', null)

  const totalExpected = ((reg.adult_count as number) ?? 1) + ((reg.student_count as number) ?? 2)

  // Notify registrant
  const registrantEmail = reg.teacher_email as string
  const registrantFirstName = reg.teacher_first_name as string
  const ccEmails: string[] = reg.teacher_poc_email ? [reg.teacher_poc_email as string] : []

  try {
    const notifContent = groupMemberJoinedEmail({
      registrantFirstName,
      memberFirstName: person.first_name,
      memberLastName: person.last_name,
      memberEmail: person.email,
      eventTitle,
      memberCount: joinedCount ?? 1,
      totalExpected,
    })
    await sendEmail({ to: registrantEmail, cc: ccEmails, ...notifContent })
  } catch (emailErr) {
    console.error('Join notification email error (non-fatal):', emailErr)
  }

  // Individual payment link — or, on a free event, the "you're registered, no
  // payment required" notice. Shared with the group-registration form, the sheet
  // sync and the organiser's manual add, so every route into an individually-paid
  // group tells the person the same thing. (Inline here previously, which meant a
  // free event silently sent nothing and left them stuck at 'pending'.)
  await ensureIndividualPayments(db, registrationId, [{
    participantId,
    email:     person.email,
    firstName: person.first_name,
    lastName:  person.last_name,
  }])

  return NextResponse.json({ success: true, eventSlug, eventTitle, signInToken }, { status: 201 })
}
