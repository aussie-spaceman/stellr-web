import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEmail } from '@/lib/member-enums'
import { stripeClient } from '@/lib/stripe'
import { maskEmail } from '@/lib/utils'
import { findExistingRegistrations, resolveDuplicate } from '@/lib/registration-duplicates'
import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  ensurePayToken,
  payPageUrl,
} from '@/lib/registration-checkout'
import { registrationOnFileAnswer, resendPayLinkAfterResponse } from '../duplicate-answer'
import { enteredPeople, SITE_URL, type GroupBody, type TeacherPayload } from './parse'
import type { LinkedSlotNames } from './roster'

/**
 * POST /api/register/group, who is already on this event. The answer that ends the
 * request, or null to carry on. Writes nothing of its own, but an unfinished
 * registration's answer can open its checkout or resend its pay link.
 */
export async function answerDuplicates(
  db: SupabaseClient,
  body: GroupBody,
  teacher: TeacherPayload,
  event: { stripePriceId?: string },
  sessionEmail: string | null | undefined,
  linkedSlotNames: LinkedSlotNames,
): Promise<Response | null> {
  const { event_slug, details_method } = body

  // Duplicate checks — one lookup for the organiser and everyone entered,
  // filtered to this event and ignoring withdrawn rows (see
  // lib/registration-duplicates.ts for why the inline version was wrong).
  const entered = details_method === 'add_now' ? enteredPeople(body) : []
  const existing = await findExistingRegistrations(db, [teacher.email, ...entered.map((p) => p.email)], event_slug)

  // Organiser: an unpaid card registration of their own is resumed, not
  // refused — them (session matches) straight to a fresh checkout and an answer
  // specific to their registration. Anyone else gets one answer whatever its
  // state (lib/registration/duplicate-answer), with any pay link sent by email.
  const sessionMatches = !!sessionEmail && normalizeEmail(sessionEmail) === teacher.email
  const dup = resolveDuplicate(existing.get(teacher.email), { sessionMatches })
  if (dup.kind !== 'none') {
    const existingRegId = dup.registration.registrationId
    if (!sessionMatches) {
      // An unfinished INDIVIDUAL registration isn't resumed from the group form.
      if (dup.kind === 'email_link' && dup.registration.type === 'group') {
        resendPayLinkAfterResponse(db, existingRegId, 'register/group pay-link resend')
      }
      return registrationOnFileAnswer('Teams')
    }
    // An unfinished INDIVIDUAL registration isn't resumed from the group form.
    if (dup.kind === 'resume' && dup.registration.type !== 'group') {
      return NextResponse.json(
        { code: 'already_registered', error: `${teacher.email} already has an individual registration for this event. Complete its payment from the link in your email, or under Account → Billing.` },
        { status: 409 },
      )
    }
    if (dup.kind === 'resume') {
      const stripe = stripeClient()
      if (stripe) {
        try {
          const { url } = await createRegistrationCheckout(db, stripe, existingRegId, {
            event,
            customerEmail: teacher.email,
            successUrl: `${SITE_URL}/register/${event_slug}/confirmation?id=${existingRegId}&type=group&payment=success`,
            cancelUrl: payPageUrl(event_slug, await ensurePayToken(db, existingRegId), { cancelled: true }),
          })
          return NextResponse.json({ resume: true, registrationId: existingRegId, checkoutUrl: url }, { status: 200 })
        } catch (e) {
          if (!(e instanceof RegistrationCheckoutError)) console.error('[register/group] resume checkout failed:', e)
        }
      }
    }
    if (dup.kind === 'invoice_pending') {
      return NextResponse.json(
        { code: 'invoice_pending', error: `An invoice for this group was already sent to ${maskEmail(teacher.email)}. Pay from that email, or reply to it if you need it re-sent.` },
        { status: 409 },
      )
    }
    if (dup.kind === 'in_group') {
      return NextResponse.json(
        { code: 'in_group', error: `${teacher.email} is already part of a group registration for this event.` },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { code: 'already_registered', error: `${teacher.email} is already registered for this event. If that’s you, sign in to see it under Account → Teams.` },
      { status: 409 },
    )
  }

  // Participants entered now: anyone already on this event (any status but
  // withdrawn) is a conflict — they'd end up on two rosters.
  // Only an address the caller typed is shown in full. A linked slot answers with
  // the name it was submitted with.
  const shown = new Set(
    entered
      .filter((p) => (existing.get(p.email) ?? []).length > 0)
      .map((p) => {
        const linkedName = linkedSlotNames.get(p)
        return linkedName ? [linkedName.first_name, linkedName.last_name].filter(Boolean).join(' ') : p.email
      }),
  )
  if (shown.size > 0) {
    return NextResponse.json({ error: `Already registered for this event: ${[...shown].join(', ')}` }, { status: 409 })
  }
  return null
}
