import { NextResponse } from 'next/server'
import { prepareRegistrationAddons, addRegistrationAddons } from '@/lib/store/event-merch'
import { stripeClient } from '@/lib/stripe'
import { createRegistrationCheckout, RegistrationCheckoutError, payPageUrl } from '@/lib/registration-checkout'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'
import { confirmRegistration } from '@/lib/registration-confirm'
import type { GateDeps, GatedRegistration } from './gate'
import type { IndividualBody } from './parse'
import type { PersistedRegistration } from './persist'

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
// Where a registrant lands afterwards — the member portal, with a flag the
// /community page reads to pop the "registration submitted" modal.
export const POST_REGISTER_URL = `${APP_URL}/community?registered=1&type=individual`

/** POST /api/register/individual, the last step: add-ons, then what is owed, then the answer. */
export async function respondToIndividualRegistration(
  gated: GatedRegistration,
  row: PersistedRegistration,
  signInToken: string | null,
  body: IndividualBody,
  getEvent: GateDeps['getEvent'],
): Promise<Response> {
  const { db, email, scholarship } = gated
  const { regId, payToken, memberId } = row
  const { event_slug } = body

  // Price any merch add-ons selected — validated + persisted as pending items
  // on the registration's event-merch order until payment clears.
  const event = await getEvent(event_slug)
  const stripe = stripeClient()
  const addonLines = await prepareRegistrationAddons(db, event_slug, body.merch_addons ?? [])
  if (addonLines.length > 0) {
    await addRegistrationAddons(db, regId, addonLines, memberId)
  }

  // A full scholarship with no paid add-ons: nothing to collect, so confirm
  // the registration here rather than sending the student through a $0
  // checkout. Same confirmation step and email as a paid one.
  if (scholarship?.percent_off === 100 && addonLines.length === 0) {
    await confirmRegistration(regId, false)
    return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken }, { status: 201 })
  }

  if (!stripe) {
    // No payment due — sign in (client) and go straight to /community.
    return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken }, { status: 201 })
  }

  // Stripe Checkout (event fee + any add-ons), built from the registration
  // row by the same helper the pay page uses — so the checkout can be
  // rebuilt later if this one is abandoned. Cancel lands on the pay page,
  // not a blank form.
  let checkoutUrl: string | null = null
  try {
    const session = await createRegistrationCheckout(db, stripe, regId, {
      // The gate's copy if this second read comes back empty: the checkout
      // refuses an unresolved event, and this registration's event is known.
      event: event ?? gated.event,
      customerEmail: email,
      // After payment, land in the member portal with the registration modal —
      // the client signs the registrant in before redirecting to Stripe, so the
      // session cookie is already set when they return here.
      successUrl: `${POST_REGISTER_URL}&payment=success`,
      cancelUrl: payPageUrl(event_slug, payToken, { cancelled: true }),
    })
    checkoutUrl = session.url
  } catch (e) {
    if (e instanceof RegistrationCheckoutError && e.code === 'nothing_to_pay') {
      // Free event (and no add-ons) — nothing to collect.
      return NextResponse.json({ registrationId: regId, checkoutUrl: null, signInToken }, { status: 201 })
    }
    throw e
  }

  // The way back if the redirect below is never completed: the registrant
  // (and their emergency contact — for a minor, the parent who is usually the
  // one paying) get the durable pay link now. Non-fatal.
  try {
    await sendPayLinkEmail(db, regId, { force: true })
  } catch (emailErr) {
    console.error('[register/individual] pay-link email failed (non-fatal):', emailErr)
  }

  return NextResponse.json({ registrationId: regId, checkoutUrl, signInToken }, { status: 201 })
}
