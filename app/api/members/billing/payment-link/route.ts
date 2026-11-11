import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { createRegistrationCheckout, RegistrationCheckoutError } from '@/lib/registration-checkout'
import { GUARANTEE_CHECKOUT_TEXT } from '@/lib/guarantee'
import { ensureSeatPayToken, seatDiscount, seatPayPageUrl } from '@/lib/individual-payment'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rowTenant, tenantPaymentsUnavailable } from '@/lib/registration/event-context'

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

// POST /api/members/billing/payment-link  { registrationId }
// Creates a Stripe checkout for an outstanding event payment the SIGNED-IN
// member is responsible for — an individual registration, or a group
// registration where the member pays their own share. Group payments owned by
// an organiser are NOT payable here (the organiser settles their invoice).
export async function POST(req: NextRequest) {
  return audited(req, { action: 'member.payment_link.create', table: 'registrations' }, () => createPaymentLink(req))
}

async function createPaymentLink(req: NextRequest) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { registrationId } = await req.json().catch(() => ({})) as { registrationId?: string }
  if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 })

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db
    .from('registrations')
    .select('event_slug, event_title, type, status, member_pays_individually, invoice_coupon_id, share_estimate, tenant_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (!registration) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  const { data: participant } = await db
    .from('participants')
    .select('id, individual_payment_status')
    .eq('registration_id', registrationId)
    .eq('member_id', member.id)
    .maybeSingle()
  if (!participant) return NextResponse.json({ error: 'You are not part of this registration' }, { status: 403 })
  // On Stellr's chain, as every member route's row is (docs/TENANCY-S5.md, B16). The
  // registration id leads to the event and its tenant.
  noteAudit(req, { targetId: registrationId })
  // S5 A8: no Checkout is made on Stellr's Stripe account for another tenant's
  // registration until S9. It gets the tenant payments answer before Stripe is asked.
  if (rowTenant((registration as { tenant_id?: string | null }).tenant_id) !== STELLR_TENANT_ID) {
    return tenantPaymentsUnavailable()
  }

  // Only the member's OWN outstanding payment is payable here.
  const isIndividual = registration.type === 'individual'
  const selfPayable = isIndividual
    ? registration.status === 'pending'
    // Pending = owed by their own link, in an individually paid or a split group.
    : participant.individual_payment_status === 'pending'
  if (!selfPayable) {
    return NextResponse.json({ error: 'No payment is due from you for this registration.' }, { status: 400 })
  }

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  // Individual: the same checkout the registration form and pay page build —
  // fee plus any pending merch add-ons, metadata the webhook already matches.
  if (isIndividual) {
    try {
      const { url } = await createRegistrationCheckout(db, stripe, registrationId, {
        customerEmail: member.email,
        successUrl: `${APP_URL}/account?tab=billing&paid=1`,
        cancelUrl: `${APP_URL}/account?tab=billing`,
      })
      return NextResponse.json({ url })
    } catch (e) {
      if (e instanceof RegistrationCheckoutError) {
        const status = e.code === 'no_price' ? 503 : 400
        return NextResponse.json({ error: e.code === 'nothing_to_pay' ? 'No payment is due from you for this registration.' : e.message }, { status })
      }
      throw e
    }
  }

  // A group sharing the teacher's cost: the seat's own pay page prices the share
  // and takes a code for the place only (lib/teacher-share.ts).
  if ((registration as { share_estimate?: number | null }).share_estimate != null) {
    const token = await ensureSeatPayToken(db, participant.id as string)
    return NextResponse.json({ url: seatPayPageUrl(registration.event_slug as string, token) })
  }

  const event = await getEventBySlug(registration.event_slug)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
  if (!stripePriceId) return NextResponse.json({ error: 'No price configured for this event' }, { status: 400 })

  // Member-pays-individually: metadata mirrors lib/individual-payment so the
  // webhook's markIndividualPayment settles this member's seat. deep review PAY-7:
  // carry participantId so the webhook settles THIS seat by id — member.email
  // follows Clerk and may differ from the frozen registration-time participant
  // email the webhook would otherwise match on (payment taken, seat never paid).
  const metadata: Record<string, string> = {
    registrationId,
    eventSlug: registration.event_slug,
    participantId: participant.id,
    participantEmail: member.email,
    isIndividualGroupPayment: 'true',
  }

  // Refuse to take money on a production deployment holding TEST keys. A test-mode
  // charge looks successful and settles nothing — the Stripe equivalent of the
  // DocuSign sandbox envelopes that were not binding signatures. Reads are
  // deliberately not gated: a wrong price is visible, a phantom payment is not.
  assertLiveCredentials('stripe')

  const session = await stripe.checkout.sessions.create({
    // The money-back guarantee, on Stripe's page above the Pay button.
    custom_text: GUARANTEE_CHECKOUT_TEXT,
    mode: 'payment',
    ...(await seatDiscount(stripe, registration.invoice_coupon_id as string | null)),
    line_items: [{ price: stripePriceId, quantity: 1 }],
    client_reference_id: registrationId,
    customer_email: member.email,
    customer_creation: 'always',
    metadata,
    success_url: `${APP_URL}/account?tab=billing&paid=1`,
    cancel_url: `${APP_URL}/account?tab=billing`,
  })

  return NextResponse.json({ url: session.url })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
