// Single source of truth for "is this registration paid?", shared by the admin
// roster pills (lib/event-admin.ts) and the access gates (lib/access-gates.ts)
// so "paid" means the same thing everywhere.
//
// Key rule: registrations.status='confirmed' is NOT proof of payment — it's set
// on card checkout / campaign auto-confirm and reused for access gating. An
// INVOICED registration is paid only once an admin records the invoice settled
// (invoice_paid_at). Card / payment-link registrations confirm on the Stripe
// webhook, or the member's own individual_payment_status='paid'.

export interface RegistrationPaymentFacts {
  invoiceRequested?: boolean | null
  invoicePaidAt?: string | null
  status?: string | null
  /** The specific participant's individual payment status, when applicable. */
  individualPaymentStatus?: string | null
}

/** Roster pill states, derived from the same facts as registrationPaid(). */
export type PaymentPillState =
  | 'invoice_issued' | 'invoice_paid' | 'link_unpaid' | 'link_paid' | 'waived'

// The admin roster's payment pill. Lives here rather than inline in
// lib/event-admin.ts so the mapping is a pure function that can be tested
// without a database, and so "what does this payment state mean" has one home.
export function paymentPill(facts: RegistrationPaymentFacts): PaymentPillState {
  const paid = registrationPaid(facts)
  if (facts.invoiceRequested) return paid ? 'invoice_paid' : 'invoice_issued'
  // Checked before `paid` because registrationPaid() counts 'waived' as paid —
  // settled, but no money changed hands, which staff reconciling payments need
  // to see as distinct from a real receipt.
  if (facts.individualPaymentStatus === 'waived') return 'waived'
  return paid ? 'link_paid' : 'link_unpaid'
}

export function registrationPaid(facts: RegistrationPaymentFacts): boolean {
  if (facts.invoiceRequested) return facts.invoicePaidAt != null
  return (
    facts.status === 'confirmed' ||
    facts.individualPaymentStatus === 'paid' ||
    // 'waived' = free event under "members pay individually": nothing was ever
    // owed, so nothing is outstanding. Without this the admin roster pill and
    // the access gate read a free participant as unpaid forever.
    facts.individualPaymentStatus === 'waived'
  )
}
