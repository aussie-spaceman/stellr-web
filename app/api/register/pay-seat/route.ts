import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { auditMutation } from '@/lib/audit/route'
import { eventOwner, rowTenant, tenantPaymentsUnavailable } from '@/lib/registration/event-context'
import { stripeClient } from '@/lib/stripe'
import { createSeatCheckout, seatPayPageUrl } from '@/lib/individual-payment'
import { createSharedSeatCheckout } from '@/lib/teacher-share'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// POST /api/register/pay-seat  { token, code? }  (code: groups sharing the teacher's cost)
// Mints a Stripe Checkout for one "members pay individually" seat behind a
// per-participant pay token (deep review PAY-8). Unauthenticated by design — the
// token is the capability, and all it can do is open a checkout whose amount is
// fixed server-side. Mirrors /api/register/pay (the whole-registration pay link)
// so a sheet-added student with no member account always has a way back to pay.
// Works whether or not the event's registration is still open: closing it stops
// new sign-ups, not payment for a place someone already holds.
//
// S5 A7: only Stellr's seats are paid here, through Stellr's Stripe account. A seat
// of another tenant than the request's gets the unknown link's answer, and a
// tenant's own takes no payment until S9. Both checkouts below (the plain seat and
// the shared teacher's cost one) run only after every tenant and owner check.

/** What the audit event says, filled in as the request goes. */
interface AuditNote {
  status: number
  participantId: string | null
  /** A Checkout was asked for: every tenant, owner and configuration check passed. */
  started: boolean
  /** The handler answered (false only when it threw). */
  answered: boolean
}

/**
 * S5 A7: one platform audit event per seat checkout started, after the response, off
 * unless PLATFORM_AUDIT_ENABLED=true. A 4xx is a refusal and is not recorded, the
 * rule withAudit applies (lib/audit/route). Nor is an answer given before any
 * Checkout was tried, such as a tenant's 503: no payment started.
 */
async function recordSeatPaymentStart(note: AuditNote): Promise<void> {
  if (note.status >= 400 && note.status < 500) return
  if (note.answered && !note.started) return
  await auditMutation(
    {
      action: 'registration.seat_payment.start',
      actor: { userId: null },
      tenant: { tenantId: STELLR_TENANT_ID },
      target: note.participantId ? { table: 'participants', id: note.participantId } : undefined,
      metadata: { status: note.status },
    },
    { afterResponse: true },
  )
}

export async function POST(req: NextRequest) {
  const note: AuditNote = { status: 500, participantId: null, started: false, answered: false }
  const answer = (res: Response): Response => {
    note.status = res.status
    note.answered = true
    return res
  }
  try {
    const { tenantId: requestTenantId } = await requestTenant()
    const limited = await rateLimit(req, 'register/pay-seat', { limit: 20, windowMs: 10 * 60_000, tenantId: requestTenantId })
    if (limited) {
      note.status = limited.status
      note.answered = true
      return limited
    }

    const body = await req.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return answer(NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 }))
    }

    const db = supabaseServer()
    const { data: partRow } = await db
      .from('participants')
      .select('id, email, registration_id, individual_payment_status')
      .eq('pay_token', token)
      .maybeSingle()
    const participant = partRow as {
      id: string
      email: string
      registration_id: string
      individual_payment_status: string | null
    } | null
    if (!participant) return answer(NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 }))

    // S5 A7: the seat's registration is read first, so another tenant's seat gets the
    // unknown link's answer before anything about its payment is told.
    const { data: regRow } = await db
      .from('registrations')
      .select('event_slug, event_title, member_pays_individually, invoice_coupon_id, share_estimate, tenant_id')
      .eq('id', participant.registration_id)
      .maybeSingle()
    const reg = regRow as {
      event_slug: string
      event_title: string
      member_pays_individually: boolean
      invoice_coupon_id: string | null
      share_estimate: number | null
      tenant_id?: string | null
    } | null
    if (!reg) return answer(NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 }))
    const regTenant = rowTenant(reg.tenant_id)
    if (regTenant !== requestTenantId) return answer(NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 }))

    if (participant.individual_payment_status === 'paid') {
      return answer(NextResponse.json({ error: 'This seat is already paid.', code: 'already_paid' }, { status: 409 }))
    }
    if (participant.individual_payment_status === 'waived') {
      return answer(NextResponse.json({ error: 'There’s nothing to pay for this seat.', code: 'nothing_to_pay' }, { status: 409 }))
    }
    // A pending seat is owed by its own link, in an individually paid group or in a
    // split one ("Invoice for some"); anything else now pays together.
    if (!reg.member_pays_individually && participant.individual_payment_status !== 'pending') {
      return answer(NextResponse.json({ error: 'This group now pays together, so nothing is due from you here.', code: 'not_individual' }, { status: 409 }))
    }
    if (regTenant !== STELLR_TENANT_ID) return answer(tenantPaymentsUnavailable())

    // S5 A7: and the event's owner, so a seat on a registration stamped Stellr's, for an
    // event the mirror gives a tenant, opens no Checkout on Stellr's account.
    const owner = await eventOwner(db, reg.event_slug).catch(() => ({ ok: false as const }))
    if (!owner.ok) {
      return answer(NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 503 }))
    }
    if (owner.tenantId !== STELLR_TENANT_ID) return answer(tenantPaymentsUnavailable())

    const stripe = stripeClient()
    if (!stripe) return answer(NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 }))

    const successUrl = `${SITE_URL}/register/${reg.event_slug}/confirmation?id=${participant.registration_id}&type=group&payment=success`
    note.started = true

    // A group sharing the teacher's cost (lib/teacher-share.ts): the place plus the
    // student's share, with a code typed on the pay page.
    if (reg.share_estimate != null) {
      try {
        const shared = await createSharedSeatCheckout(db, stripe, {
          participantId: participant.id,
          participantEmail: participant.email,
          registrationId: participant.registration_id,
          eventSlug: reg.event_slug,
          eventTitle: reg.event_title,
          successUrl,
          cancelUrl: seatPayPageUrl(reg.event_slug, token, { cancelled: true }),
          discountCode: typeof body?.code === 'string' ? body.code.slice(0, 64) : null,
          groupCouponId: reg.invoice_coupon_id,
        })
        if ('waived' in shared) {
          note.participantId = participant.id
          return answer(NextResponse.json({ waived: true, message: 'Nothing to pay: your place is confirmed.' }))
        }
        if ('error' in shared) {
          const status = shared.error === 'bad_code' ? 400 : shared.error === 'no_price' ? 503 : 409
          return answer(NextResponse.json({ error: shared.message, code: shared.error }, { status }))
        }
        note.participantId = participant.id
        return answer(NextResponse.json({ url: shared.url }))
      } catch (e) {
        console.error('[register/pay-seat] shared checkout create failed:', e)
        return answer(NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 502 }))
      }
    }

    try {
      const result = await createSeatCheckout(stripe, {
        participantId: participant.id,
        participantEmail: participant.email,
        registrationId: participant.registration_id,
        eventSlug: reg.event_slug,
        // The payer is often a parent who isn't signed in — let them enter their own
        // email for the receipt (same choice as the registration pay page).
        customerEmail: null,
        couponId: reg.invoice_coupon_id,
        successUrl,
        cancelUrl: seatPayPageUrl(reg.event_slug, token, { cancelled: true }),
      })
      if ('error' in result) {
        return answer(result.error === 'free'
          ? NextResponse.json({ error: 'There’s nothing to pay for this seat.', code: 'nothing_to_pay' }, { status: 409 })
          : NextResponse.json({ error: 'This event’s fee is misconfigured — please contact Stellr.', code: 'no_price' }, { status: 503 }))
      }
      note.participantId = participant.id
      return answer(NextResponse.json({ url: result.url }))
    } catch (e) {
      console.error('[register/pay-seat] checkout create failed:', e)
      return answer(NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 502 }))
    }
  } finally {
    await recordSeatPaymentStart(note)
  }
}
