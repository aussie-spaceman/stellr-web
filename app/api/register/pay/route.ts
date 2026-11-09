import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/events/repo'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { auditMutation } from '@/lib/audit/route'
import { readRegistrationEvent, resolveEventOwner, rowTenant, tenantPaymentsUnavailable } from '@/lib/registration/event-context'
import { stripeClient } from '@/lib/stripe'
import {
  createRegistrationCheckout,
  RegistrationCheckoutError,
  payPageUrl,
} from '@/lib/registration-checkout'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// POST /api/register/pay  { token }
// Mints a Stripe Checkout for the pending registration behind a pay token.
// Unauthenticated by design — the token is the capability, and the only thing
// it can do is open a checkout whose amount is fixed server-side. The link works
// whether or not the event's registration is still open: closing registration
// stops new sign-ups, not payment for a place someone already holds.
//
// S5 A7: only Stellr's registrations are paid here, through Stellr's Stripe account.
// A registration of another tenant than the request's gets the unknown link's
// answer, and a tenant's own takes no payment until S9.

/** What the audit event says, filled in as the request goes. */
interface AuditNote {
  status: number
  registrationId: string | null
  /** A Checkout was asked for: every tenant, owner and configuration check passed. */
  started: boolean
  /** The handler answered (false only when it threw). */
  answered: boolean
}

/**
 * S5 A7: one platform audit event per checkout started, after the response, off
 * unless PLATFORM_AUDIT_ENABLED=true. A 4xx is a refusal and is not recorded, the
 * rule withAudit applies (lib/audit/route). Nor is an answer given before any
 * Checkout was tried, such as a tenant's 503: no payment started.
 */
async function recordPaymentStart(note: AuditNote): Promise<void> {
  if (note.status >= 400 && note.status < 500) return
  if (note.answered && !note.started) return
  await auditMutation(
    {
      action: 'registration.payment.start',
      actor: { userId: null },
      tenant: { tenantId: STELLR_TENANT_ID },
      target: note.registrationId ? { table: 'registrations', id: note.registrationId } : undefined,
      metadata: { status: note.status },
    },
    { afterResponse: true },
  )
}

export async function POST(req: NextRequest) {
  const note: AuditNote = { status: 500, registrationId: null, started: false, answered: false }
  const answer = (res: Response): Response => {
    note.status = res.status
    note.answered = true
    return res
  }
  try {
    const { tenantId: requestTenantId } = await requestTenant()
    const limited = await rateLimit(req, 'register/pay', { limit: 20, windowMs: 10 * 60_000, tenantId: requestTenantId })
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
    const { data: regRow } = await db
      .from('registrations')
      .select('id, event_slug, type, status, tenant_id')
      .eq('pay_token', token)
      .maybeSingle()
    const reg = regRow as { id: string; event_slug: string; type: string; status: string; tenant_id?: string | null } | null
    if (!reg) return answer(NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 }))
    // Another tenant's registration: the unknown link's answer, before its state is told.
    const regTenant = rowTenant(reg.tenant_id)
    if (regTenant !== requestTenantId) return answer(NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 }))
    if (reg.status === 'confirmed') {
      return answer(NextResponse.json({ error: 'This registration is already paid.', code: 'already_paid' }, { status: 409 }))
    }
    if (reg.status !== 'pending') {
      return answer(NextResponse.json({ error: 'This registration has no payment outstanding.', code: 'not_pending' }, { status: 409 }))
    }
    if (regTenant !== STELLR_TENANT_ID) return answer(tenantPaymentsUnavailable())

    // Fail closed, as the registration routes do: without the event the fee can't
    // be known. An outage is retryable; an event that no
    // longer resolves needs a person, the same answer as an event with no price.
    //
    // S5 A7: the event's owner is read too, so a registration stamped Stellr's for an
    // event the mirror gives a tenant opens no Checkout on Stellr's account.
    const retryLater = () =>
      answer(NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 503 }))
    const misconfigured = () =>
      answer(NextResponse.json(
        { error: 'This event’s registration fee is misconfigured — please contact Stellr.', code: 'no_price' },
        { status: 503 },
      ))
    const read = await readRegistrationEvent(reg.event_slug, { getEvent: getEventBySlug, route: 'register/pay' })
    if (read.kind === 'unavailable') return retryLater()
    if (read.kind === 'not_found') return misconfigured()
    const owner = await resolveEventOwner(read.event, reg.event_slug, { db, requestTenantId, route: 'register/pay' })
    if (owner.kind === 'unavailable') return retryLater()
    // The registration is this host's (checked above), but the mirror gives its event
    // to someone else: nothing is taken on Stellr's account for it, as pay-seat answers.
    if (owner.kind === 'not_found') return answer(tenantPaymentsUnavailable())
    // ok here means the owner is this host's tenant, which is Stellr: any other
    // registration was refused above.
    if (owner.kind !== 'ok') return misconfigured()
    const event = read.event
    const stripe = stripeClient()
    if (!stripe) return answer(NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 }))

    // Land on the public confirmation page, not the member portal: the payer is
    // often a parent who isn't signed in as the registrant.
    const successUrl =
      reg.type === 'individual'
        ? `${SITE_URL}/register/${reg.event_slug}/confirmation?id=${reg.id}&type=individual&payment=success`
        : `${SITE_URL}/register/${reg.event_slug}/confirmation?id=${reg.id}&type=group&payment=success`

    note.started = true
    try {
      const { url } = await createRegistrationCheckout(db, stripe, reg.id, {
        event: event as { stripePriceId?: string },
        customerEmail: null,
        successUrl,
        cancelUrl: payPageUrl(reg.event_slug, token, { cancelled: true }),
      })
      note.registrationId = reg.id
      return answer(NextResponse.json({ url }))
    } catch (e) {
      if (e instanceof RegistrationCheckoutError) {
        const status =
          e.code === 'not_found' ? 404
          : e.code === 'not_pending' ? 409
          : e.code === 'no_price' ? 503
          : 400
        const error =
          e.code === 'nothing_to_pay'
            ? 'There’s nothing left to pay on this registration. Reply to your registration email if you think that’s wrong.'
            : e.code === 'no_price'
              ? 'This event’s registration fee is misconfigured — please contact Stellr.'
              : e.message
        return answer(NextResponse.json({ error, code: e.code }, { status }))
      }
      console.error('[register/pay] checkout create failed:', e)
      return answer(NextResponse.json({ error: 'Payment could not be started. Please try again shortly.' }, { status: 502 }))
    }
  } finally {
    await recordPaymentStart(note)
  }
}
