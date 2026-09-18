import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getEventBySlug } from '@/lib/sanity'
import { assertLiveCredentials } from '@/lib/env-guards'

// The one place that knows how to build a Stripe Checkout for a registration.
//
// Before this, three routes each assembled their own session — the individual
// form, the group form, and the member billing "Pay now" — and they had already
// drifted: billing omitted merch add-ons and tested a status that doesn't exist.
// Worse, a checkout existed only at the moment of the redirect. A parent who
// closed the tab (17 Sept 2026, Colorado) had no way back to a payment for a
// registration that was otherwise complete.
//
// So: the registration row is the source of truth, and a checkout can be
// rebuilt from it at any time while it is still pending. Metadata keeps the
// exact shape the Stripe webhook already matches on (registrationId +
// isGroup), so no webhook change is needed for a session minted here.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

export type RegistrationCheckoutErrorCode =
  | 'not_found'
  | 'not_pending'
  | 'not_card'
  | 'no_price'
  | 'nothing_to_pay'

export class RegistrationCheckoutError extends Error {
  constructor(public code: RegistrationCheckoutErrorCode, message: string) {
    super(message)
    this.name = 'RegistrationCheckoutError'
  }
}

export interface CreateRegistrationCheckoutOptions {
  successUrl: string
  cancelUrl: string
  /** Skip the Sanity fetch when the caller already holds the event document. */
  event?: { stripePriceId?: string } | null
  /**
   * Pre-fills Stripe's (read-only) email field. Omit — pass null — on sessions
   * minted from the pay link: the payer is often a parent, and they should be
   * able to enter their own address and receive the receipt.
   */
  customerEmail?: string | null
}

export interface RegistrationCheckoutResult {
  url: string
  sessionId: string
  amountCents: number
}

interface RegistrationForCheckout {
  id: string
  event_slug: string
  event_title: string
  type: 'individual' | 'group' | 'campaign'
  status: 'pending' | 'confirmed' | 'withdrawn'
  invoice_requested: boolean
  member_pays_individually: boolean
  adult_count: number | null
  student_count: number | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  teacher_email: string | null
}

const REGISTRATION_COLUMNS =
  'id, event_slug, event_title, type, status, invoice_requested, member_pays_individually, adult_count, student_count, teacher_first_name, teacher_last_name, teacher_email'

export async function createRegistrationCheckout(
  db: SupabaseClient,
  stripe: Stripe,
  registrationId: string,
  opts: CreateRegistrationCheckoutOptions,
): Promise<RegistrationCheckoutResult> {
  const { data: regRow } = await db
    .from('registrations')
    .select(REGISTRATION_COLUMNS)
    .eq('id', registrationId)
    .maybeSingle()
  const reg = regRow as RegistrationForCheckout | null
  if (!reg) throw new RegistrationCheckoutError('not_found', 'Registration not found')
  if (reg.status !== 'pending') {
    throw new RegistrationCheckoutError('not_pending', 'This registration has no payment outstanding')
  }
  // Invoices are Stripe-hosted and members-pay-individually settles per person
  // — neither is a single card checkout for the whole registration.
  if (reg.invoice_requested || reg.member_pays_individually) {
    throw new RegistrationCheckoutError('not_card', 'This registration is not paid by card checkout')
  }

  const event = opts.event === undefined ? await getEventBySlug(reg.event_slug) : opts.event
  const stripePriceId = (event as { stripePriceId?: string } | null)?.stripePriceId ?? null

  // Fee per seat. A $0 price object — how free events are configured — must not
  // become a line item: Stripe can't open a session for a zero total.
  let unitCents = 0
  if (stripePriceId) {
    const price = await stripe.prices.retrieve(stripePriceId)
    unitCents = price.unit_amount ?? 0
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []
  let amountCents = 0
  let metadata: Record<string, string>
  let defaultEmail: string | null = null

  if (reg.type === 'individual') {
    const { data: partRow } = await db
      .from('participants')
      .select('first_name, last_name, email')
      .eq('registration_id', reg.id)
      .limit(1)
      .maybeSingle()
    const participant = partRow as { first_name: string; last_name: string; email: string } | null

    if (stripePriceId && unitCents > 0) {
      lineItems.push({ price: stripePriceId, quantity: 1 })
      amountCents += unitCents
    }
    // Paid merch add-ons chosen on the form sit as pending items on the
    // registration's event-merch order until payment clears.
    for (const addon of await pendingAddonLines(db, reg.id)) {
      lineItems.push({
        quantity: addon.qty,
        price_data: { currency: 'usd', unit_amount: addon.unitCents, product_data: { name: addon.name } },
      })
      amountCents += addon.unitCents * addon.qty
    }
    metadata = {
      registrationId: reg.id,
      eventSlug: reg.event_slug,
      participantName: participant ? `${participant.first_name} ${participant.last_name}`.trim() : '',
    }
    defaultEmail = participant?.email ?? null
  } else {
    if (!stripePriceId) throw new RegistrationCheckoutError('no_price', 'No price configured for this event')
    const quantity = await groupSeatCount(db, reg)
    if (quantity <= 0 || unitCents <= 0) {
      throw new RegistrationCheckoutError('nothing_to_pay', 'Nothing to collect for this registration')
    }
    lineItems.push({ price: stripePriceId, quantity })
    amountCents = unitCents * quantity
    metadata = {
      registrationId: reg.id,
      eventSlug: reg.event_slug,
      isGroup: 'true',
      teacherName: `${reg.teacher_first_name ?? ''} ${reg.teacher_last_name ?? ''}`.trim(),
    }
    defaultEmail = reg.teacher_email
  }

  if (lineItems.length === 0) {
    throw new RegistrationCheckoutError('nothing_to_pay', 'Nothing to collect for this registration')
  }

  // Refuse to take money on a production deployment holding TEST keys. A test-mode
  // charge looks successful and settles nothing — the Stripe equivalent of the
  // DocuSign sandbox envelopes that were not binding signatures.
  assertLiveCredentials('stripe')

  const customerEmail = opts.customerEmail === undefined ? defaultEmail : opts.customerEmail
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // Surfaces the "Add promotion code" field for codes set up in Stripe.
    allow_promotion_codes: true,
    line_items: lineItems,
    client_reference_id: reg.id,
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    // Always mint a Customer so the receipt is retrievable in the billing tab
    // (the webhook persists session.customer onto the member row).
    customer_creation: 'always',
    metadata,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  })
  if (!session.url) throw new Error('Stripe checkout session has no URL')

  return { url: session.url, sessionId: session.id, amountCents }
}

// Declared group size is authoritative (adult_count + student_count); rows
// created before migration 037 have neither, so count the roster instead.
async function groupSeatCount(db: SupabaseClient, reg: RegistrationForCheckout): Promise<number> {
  const declared = (reg.adult_count ?? 0) + (reg.student_count ?? 0)
  if (declared > 0) return declared
  const { count } = await db
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('registration_id', reg.id)
  return count ?? 0
}

interface PendingAddonLine {
  name: string
  qty: number
  unitCents: number
}

async function pendingAddonLines(db: SupabaseClient, registrationId: string): Promise<PendingAddonLine[]> {
  const { data: order } = await db
    .from('store_orders')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('channel', 'event_registration')
    .maybeSingle()
  const orderId = (order as { id?: string } | null)?.id
  if (!orderId) return []
  const { data: items } = await db
    .from('store_order_items')
    .select('name, qty, unit_amount_cents')
    .eq('order_id', orderId)
    .eq('line_source', 'event_addon')
    .eq('fulfillment_status', 'pending')
  return ((items ?? []) as { name: string; qty: number; unit_amount_cents: number }[])
    .filter((i) => i.qty > 0 && i.unit_amount_cents > 0)
    .map((i) => ({ name: i.name, qty: i.qty, unitCents: i.unit_amount_cents }))
}

// ── Pay-later capability ──────────────────────────────────────────────────────

export function mintPayToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * The registration's pay token, minting one if it has none. Registrations
 * created before the column existed (and rows inserted by paths that don't
 * mint up front) get theirs the first time a link is needed.
 */
export async function ensurePayToken(db: SupabaseClient, registrationId: string): Promise<string> {
  const { data } = await db
    .from('registrations')
    .select('pay_token')
    .eq('id', registrationId)
    .maybeSingle()
  const existing = (data as { pay_token?: string | null } | null)?.pay_token
  if (existing) return existing

  const token = mintPayToken()
  // `.is('pay_token', null)` keeps two concurrent mints from clobbering each
  // other — the loser re-reads and returns the winner's token.
  const { data: updated } = await db
    .from('registrations')
    .update({ pay_token: token })
    .eq('id', registrationId)
    .is('pay_token', null)
    .select('pay_token')
    .maybeSingle()
  const won = (updated as { pay_token?: string | null } | null)?.pay_token
  if (won) return won

  const { data: reread } = await db
    .from('registrations')
    .select('pay_token')
    .eq('id', registrationId)
    .maybeSingle()
  const current = (reread as { pay_token?: string | null } | null)?.pay_token
  if (!current) throw new Error(`Could not mint pay token for registration ${registrationId}`)
  return current
}

export function payPageUrl(eventSlug: string, token: string, opts?: { cancelled?: boolean }): string {
  return `${SITE_URL}/register/${eventSlug}/pay/${token}${opts?.cancelled ? '?cancelled=1' : ''}`
}
