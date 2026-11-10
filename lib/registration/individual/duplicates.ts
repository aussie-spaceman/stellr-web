import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeClient } from '@/lib/stripe'
import { normalizeEmail } from '@/lib/member-enums'
import { findExistingRegistrations, resolveDuplicate } from '@/lib/registration-duplicates'
import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  ensurePayToken,
  payPageUrl,
  pendingAddonLines,
} from '@/lib/registration-checkout'
import { confirmRegistration } from '@/lib/registration-confirm'
import { attachOfferToRegistration, type ScholarshipApplication } from '@/lib/scholarships'
import { registrationOnFileAnswer, resendPayLinkAfterResponse } from '../duplicate-answer'
import { POST_REGISTER_URL } from './respond'

/**
 * The answer for someone already on this event, or null when they are not.
 *
 * Duplicate check: same email on this event. An unpaid 'pending' row is not a
 * duplicate to refuse: it's the same person coming back (17 Sept 2026: a parent
 * closed the Stripe tab and was locked out by this check). The registrant
 * themselves (session email matches) goes straight to a fresh checkout and gets
 * an answer specific to their registration. Anyone else gets one answer whatever
 * the registration's state (lib/registration/duplicate-answer), with any pay link
 * sent by email, never in the response.
 */
export async function answerDuplicate(
  db: SupabaseClient,
  ctx: {
    email: string
    eventSlug: string
    event: { stripePriceId?: string }
    sessionEmail: string | null | undefined
    scholarship: ScholarshipApplication | null
    /**
     * S5 A7: false for a tenant's event. No pay link is resent and no Checkout is
     * opened for its earlier registration: nothing reaches Stellr's Stripe account
     * for a tenant. The answers are otherwise the same.
     */
    payments: boolean
  },
): Promise<Response | null> {
  const { email, eventSlug, event, sessionEmail, scholarship, payments } = ctx
  const existing = await findExistingRegistrations(db, [email], eventSlug)
  const sessionMatches = !!sessionEmail && normalizeEmail(sessionEmail) === email
  const dup = resolveDuplicate(existing.get(email), { sessionMatches })
  if (dup.kind === 'none') return null

  const regId = dup.registration.registrationId
  // They had already registered (or started to) before using the offer
  // link: attach the scholarship to that registration, and with a full
  // scholarship confirm it now if nothing else is owed. Only for the person the
  // offer was made to, or someone signed in as the registrant.
  const offerIsTheirs = !!scholarship && (sessionMatches || normalizeEmail(scholarship.email) === email)
  if (payments && scholarship && offerIsTheirs && dup.registration.type === 'individual' && dup.kind !== 'in_group') {
    const { data: existingReg } = await db
      .from('registrations')
      .select('id, status, amount_due_cents')
      .eq('id', regId)
      .maybeSingle()
    if (existingReg) {
      const attached = await attachOfferToRegistration(db, scholarship, existingReg as { id: string; status: string; amount_due_cents: number | null }, null)
      if (
        attached &&
        scholarship.percent_off === 100 &&
        (existingReg as { status: string }).status === 'pending' &&
        (await pendingAddonLines(db, regId)).length === 0
      ) {
        await confirmRegistration(regId, false)
        return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken: null }, { status: 200 })
      }
    }
  }
  if (!sessionMatches) {
    // Arrived with an offer made to another address. Say so rather than resend a
    // full-price pay link, or the offer is lost with no explanation. A parent may
    // have applied under their own address.
    if (scholarship && !offerIsTheirs) {
      return NextResponse.json(
        {
          code: 'scholarship_other_email',
          error: 'This scholarship was offered to a different email address. Sign in with this email to use it, or reply to your scholarship email and we’ll sort it out.',
        },
        { status: 409 },
      )
    }
    // An unfinished GROUP registration isn't resumed from the individual form:
    // the organiser has the pay link in their confirmation email.
    if (payments && dup.kind === 'email_link' && dup.registration.type === 'individual') {
      resendPayLinkAfterResponse(db, regId, 'register/individual pay-link resend')
    }
    return registrationOnFileAnswer('Events')
  }
  // An unfinished GROUP registration isn't resumed from the individual form
  // — the organiser has the pay link in their confirmation email and under
  // Account → Teams.
  if (dup.kind === 'resume' && dup.registration.type !== 'individual') {
    return NextResponse.json(
      { code: 'already_registered', error: `${email} already has a group registration for this event. Complete its payment from the link in your confirmation email, or under Account → Teams.` },
      { status: 409 },
    )
  }
  if (payments && dup.kind === 'resume') {
    const stripe = stripeClient()
    if (stripe) {
      try {
        const { url } = await createRegistrationCheckout(db, stripe, regId, {
          event,
          customerEmail: email,
          successUrl: `${POST_REGISTER_URL}&payment=success`,
          cancelUrl: payPageUrl(eventSlug, await ensurePayToken(db, regId), { cancelled: true }),
        })
        return NextResponse.json({ resume: true, registrationId: regId, checkoutUrl: url }, { status: 200 })
      } catch (e) {
        // Nothing to collect (free event left pending) or a Stripe hiccup —
        // fall through to the plain "already registered" answer.
        if (!(e instanceof RegistrationCheckoutError)) console.error('[register/individual] resume checkout failed:', e)
      }
    }
  }
  if (dup.kind === 'in_group') {
    return NextResponse.json(
      { code: 'in_group', error: `${email} is already part of a group registration for this event. Ask your teacher or group organiser if anything needs changing.` },
      { status: 409 },
    )
  }
  return NextResponse.json(
    { code: 'already_registered', error: `${email} is already registered for this event. If that’s you, sign in to see it under Account → Events.` },
    { status: 409 },
  )
}
