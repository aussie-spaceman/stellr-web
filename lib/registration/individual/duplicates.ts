import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeClient } from '@/lib/stripe'
import { maskEmail } from '@/lib/utils'
import { normalizeEmail } from '@/lib/member-enums'
import { findExistingRegistrations, resolveDuplicate } from '@/lib/registration-duplicates'
import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  ensurePayToken,
  payPageUrl,
  pendingAddonLines,
} from '@/lib/registration-checkout'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'
import { confirmRegistration } from '@/lib/registration-confirm'
import { attachOfferToRegistration, type ScholarshipApplication } from '@/lib/scholarships'
import { POST_REGISTER_URL } from './respond'

/**
 * The answer for someone already on this event, or null when they are not.
 *
 * Duplicate check: same email on this event. An unpaid 'pending' row is not a
 * duplicate to refuse: it's the same person coming back (17 Sept 2026: a parent
 * closed the Stripe tab and was locked out by this check). The registrant
 * themselves (session email matches) goes straight to a fresh checkout; anyone
 * else gets the pay link by email, never in the response. The answer follows the
 * registration's state, and any address it gives is masked.
 */
export async function answerDuplicate(
  db: SupabaseClient,
  ctx: {
    email: string
    eventSlug: string
    event: { stripePriceId?: string }
    sessionEmail: string | null | undefined
    scholarship: ScholarshipApplication | null
  },
): Promise<Response | null> {
  const { email, eventSlug, event, sessionEmail, scholarship } = ctx
  const existing = await findExistingRegistrations(db, [email], eventSlug)
  const dup = resolveDuplicate(existing.get(email), {
    sessionMatches: !!sessionEmail && normalizeEmail(sessionEmail) === email,
  })
  if (dup.kind === 'none') return null

  const regId = dup.registration.registrationId
  // They had already registered (or started to) before using the offer
  // link: attach the scholarship to that registration, and with a full
  // scholarship confirm it now if nothing else is owed.
  if (scholarship && dup.registration.type === 'individual' && dup.kind !== 'in_group') {
    const { data: existingReg } = await db
      .from('registrations')
      .select('id, status, amount_due_cents')
      .eq('id', regId)
      .maybeSingle()
    if (existingReg) {
      await attachOfferToRegistration(db, scholarship, existingReg as { id: string; status: string; amount_due_cents: number | null }, null)
      if (
        scholarship.percent_off === 100 &&
        (existingReg as { status: string }).status === 'pending' &&
        (await pendingAddonLines(db, regId)).length === 0
      ) {
        await confirmRegistration(regId, false)
        return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken: null }, { status: 200 })
      }
    }
  }
  // An unfinished GROUP registration isn't resumed from the individual form
  // — the organiser has the pay link in their confirmation email and under
  // Account → Teams.
  if ((dup.kind === 'resume' || dup.kind === 'email_link') && dup.registration.type !== 'individual') {
    return NextResponse.json(
      { code: 'already_registered', error: `${email} already has a group registration for this event. Complete its payment from the link in your confirmation email, or under Account → Teams.` },
      { status: 409 },
    )
  }
  if (dup.kind === 'resume') {
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
  if (dup.kind === 'email_link') {
    const sent = await sendPayLinkEmail(db, regId).catch((e) => {
      console.error('[register/individual] pay-link resend failed (non-fatal):', e)
      return { sent: false, reason: undefined, recipients: [] as string[] }
    })
    const where = sent.recipients.length > 0 ? sent.recipients.map(maskEmail) : [maskEmail(email)]
    // Inside the resend cooldown nothing went out just now — say so, rather
    // than promising an email that isn't coming.
    const verb = sent.reason === 'cooldown' ? 'We recently emailed' : 'We’ve emailed'
    return NextResponse.json(
      {
        code: 'unfinished_registration',
        error: `This email already has an unfinished registration for this event. ${verb} a link to complete payment to ${where.join(' and ')} — check spam if it hasn’t arrived in a few minutes.`,
      },
      { status: 409 },
    )
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
