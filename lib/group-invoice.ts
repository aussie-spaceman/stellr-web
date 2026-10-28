import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { GUARANTEE_RECEIPT_LINE } from '@/lib/guarantee'

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
  // deep review PAY-1: create the invoice FIRST, then attach the line
  // item to it explicitly with `invoice: invoice.id`. The old order
  // created a *pending* invoice item and then an invoice with no
  // `pending_invoice_items_behavior`; on the pinned SDK (2026-05-27.dahlia)
  // that default EXCLUDES pending items, so the invoice finalised with no
  // line — a $0 invoice that auto-sent (and, with the webhook, stamped the
  // registration paid) for a paid event. Mirrors the known-good pattern in
  // app/api/stripe/membership-invoice/route.ts.
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: 14,
    auto_advance: false,
    metadata: { registrationId: input.registrationId, eventSlug: input.eventSlug, isGroup: 'true' },
    // The money-back guarantee, printed on the invoice.
    footer: GUARANTEE_RECEIPT_LINE,
  })
  const n = input.totalParticipants
  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: invoice.id as string,
    currency: input.currency,
    amount: input.amountCents,
    description: `${input.eventTitle} — Group Registration (${n} participant${n !== 1 ? 's' : ''} × ${input.currency.toUpperCase()} ${(input.perSeatCents / 100).toFixed(2)} each)`,
  })
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id as string)
  await stripe.invoices.sendInvoice(finalized.id as string)
  return { invoiceId: finalized.id as string }
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
