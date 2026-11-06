import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAfterResponse } from '@/lib/after-response'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'

// What a registration form answers when the address is already on this event and
// the caller has not proven it is theirs (no session for that address).
//
// One answer, whatever the state of the earlier registration: naming an address
// tells the caller nothing about it. Anyone signed in as that address still gets
// the specific answer, in the callers of this module.

/** The form shows this code as a notice, not a failure. */
export const REGISTRATION_ON_FILE = 'registration_on_file'

export function registrationOnFileAnswer(accountPage: 'Events' | 'Teams'): Response {
  return NextResponse.json(
    {
      code: REGISTRATION_ON_FILE,
      error: `This email can’t start a new registration for this event. If a payment is unfinished, check the email on file, including spam, for the link to finish it. Otherwise, sign in to see your registration under Account → ${accountPage}, or ask your group organiser.`,
    },
    { status: 409 },
  )
}

/**
 * Resend an unfinished registration's pay link once the answer has gone, so the
 * time taken to answer does not vary with whether anything was sent. The cooldown
 * in sendPayLinkEmail still applies, because this path is public.
 */
export function resendPayLinkAfterResponse(db: SupabaseClient, registrationId: string, label: string): void {
  runAfterResponse(label, () => sendPayLinkEmail(db, registrationId))
}
