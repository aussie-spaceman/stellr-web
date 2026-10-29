import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createGroupInvoice, loadRegistration, type GroupRegistration } from '@/lib/group-billing'

// The Stripe invoice for a group that chose "pay by invoice". Shared by the
// registration route and the admin "Finish registration setup" action, so a
// registration that was cut off before its invoice went out is invoiced exactly
// the way a normal one is.

export interface GroupInvoiceInput {
  registrationId: string
  eventSlug: string
  eventTitle: string
  teacher: { email: string; firstName: string; lastName: string }
  registrantMemberId: string | null
  amountCents: number
  perSeatCents: number
  currency: string
  totalParticipants: number
}

export async function createAndSendGroupInvoice(
  db: SupabaseClient,
  stripe: Stripe,
  input: GroupInvoiceInput,
): Promise<{ invoiceId: string }> {
  // Reuse the registrant's existing Stripe customer if they already have
  // one (e.g. from a membership purchase). Creating a fresh customer and
  // overwriting members.stripe_customer_id would strand their earlier
  // invoices/receipts, since /account?tab=billing lists invoices for the
  // single stored customer id.
  let customerId: string | null = null
  if (input.registrantMemberId) {
    const { data: existingMember } = await db.from('members')
      .select('stripe_customer_id').eq('id', input.registrantMemberId).maybeSingle()
    customerId = (existingMember?.stripe_customer_id as string | null) ?? null
  }
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: input.teacher.email,
      name: `${input.teacher.firstName} ${input.teacher.lastName}`,
      metadata: { registrationId: input.registrationId, eventSlug: input.eventSlug },
    })
    customerId = customer.id
    // Persist the new customer on the registrant's member row (so the
    // invoice + receipt surface in the billing tab) — but only when the
    // row has none yet, so a concurrent write is never clobbered.
    if (input.registrantMemberId) {
      await db.from('members').update({ stripe_customer_id: customerId })
        .eq('id', input.registrantMemberId).is('stripe_customer_id', null)
    }
  }
  // One per-place line (quantity × price), recorded in the group_invoices
  // ledger so a later roster change can revise it (lib/group-billing.ts, which
  // keeps the PAY-1 order: invoice first, then the line attached to it).
  // amountCents is perSeatCents × totalParticipants by construction.
  // The registration only adds a discount an admin set; if it can't be read
  // (a blip, or the 20261029 columns not yet applied) the invoice still goes.
  const reg: GroupRegistration = (await loadRegistration(db, input.registrationId)) ?? {
    id: input.registrationId, type: 'group', event_slug: input.eventSlug, event_title: input.eventTitle,
    status: 'pending', invoice_requested: true, invoice_paid_at: null, member_pays_individually: false,
    stripe_payment_intent_id: null, amount_due_cents: input.amountCents, adult_count: null, student_count: null,
    teacher_first_name: input.teacher.firstName, teacher_last_name: input.teacher.lastName,
    teacher_email: input.teacher.email, teacher_member_id: input.registrantMemberId,
    invoice_coupon_id: null, invoice_promotion_code: null,
  }
  const sent = await createGroupInvoice(db, stripe, {
    reg,
    customerId,
    seats: input.totalParticipants,
    perSeatCents: input.perSeatCents,
    currency: input.currency,
    reason: 'Group registration',
    actor: { memberId: null, label: 'system' },
    couponId: reg.invoice_coupon_id,
    kind: 'seats',
  })
  return { invoiceId: sent.id as string }
}

/**
 * The group invoice already raised for a registration, if any (open, paid or
 * draft — anything but void). Used so "Finish setup" never invoices twice.
 */
export async function findGroupInvoice(stripe: Stripe, registrationId: string): Promise<Stripe.Invoice | null> {
  const found = await stripe.invoices.search({
    query: `metadata['registrationId']:'${registrationId.replace(/'/g, '')}'`,
    limit: 10,
  })
  return found.data.find((inv) => inv.status !== 'void') ?? null
}
