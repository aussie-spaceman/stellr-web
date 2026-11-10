import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { GUARANTEE_CHECKOUT_TEXT } from '@/lib/guarantee'
import { ensureSeatPayToken, seatDiscount, seatPayPageUrl } from '@/lib/individual-payment'
import { withAudit } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rowTenant, tenantPaymentsUnavailable } from '@/lib/registration/event-context'
import { teamAudit, TEAM_SEAT_PAYMENT_LINK_AUDIT } from '@/lib/registration/team-audit'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// POST /api/members/teams/[id]/payment-link
// Creates a fresh Stripe checkout session for a member with a pending individual payment.
//
// S5 A8: only a registration of this host's tenant (another tenant's answers as
// missing), and never a Checkout for a tenant's registration until S9: that gets the
// tenant payments answer before Stripe is asked anything. Audited behind
// PLATFORM_AUDIT_ENABLED on the registration's tenant's chain.
export const POST = withAudit(TEAM_SEAT_PAYMENT_LINK_AUDIT, createSeatPaymentLink)

async function createSeatPaymentLink(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email, first_name, last_name')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Find the participant row for this member in this registration
  const { data: participant } = await db
    .from('participants')
    .select('id, individual_payment_status')
    .eq('registration_id', registrationId)
    .eq('member_id', member.id)
    .maybeSingle()

  if (!participant) return NextResponse.json({ error: 'You are not part of this team' }, { status: 403 })
  if (participant.individual_payment_status !== 'pending') {
    return NextResponse.json({ error: 'No payment required' }, { status: 400 })
  }

  // Load registration to get event slug
  const { data: registration } = await db
    .from('registrations')
    .select('event_slug, event_title, invoice_coupon_id, share_estimate, tenant_id')
    .eq('id', registrationId)
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  const regTenant = rowTenant((registration as { tenant_id?: string | null }).tenant_id)
  if (regTenant !== (await requestTenant()).tenantId) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  }
  teamAudit(req, { registrationId, tenantId: regTenant, userId })
  if (regTenant !== STELLR_TENANT_ID) return tenantPaymentsUnavailable()

  // A group sharing the teacher's cost: the seat's own pay page prices the share
  // and takes a code for the place only (lib/teacher-share.ts).
  if ((registration as { share_estimate?: number | null }).share_estimate != null) {
    const token = await ensureSeatPayToken(db, participant.id as string)
    return NextResponse.json({ url: seatPayPageUrl(registration.event_slug as string, token) })
  }

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })

  const event = await getEventBySlug(registration.event_slug)
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId
  if (!stripePriceId) return NextResponse.json({ error: 'No price configured for this event' }, { status: 400 })

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
    customer_email: member.email,
    metadata: {
      registrationId,
      eventSlug: registration.event_slug,
      // deep review PAY-7: settle THIS seat by id. member.email follows Clerk and
      // may differ from the frozen registration-time participant email the webhook
      // would otherwise match on (payment taken, seat never marked paid).
      participantId: participant.id,
      participantEmail: member.email,
      isIndividualGroupPayment: 'true',
    },
    success_url: `${SITE_URL}/register/${registration.event_slug}/confirmation?id=${registrationId}&type=group&payment=success`,
    cancel_url: `${SITE_URL}/account?tab=teams`,
  })

  return NextResponse.json({ url: session.url })
}
