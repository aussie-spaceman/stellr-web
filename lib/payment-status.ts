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

export function registrationPaid(facts: RegistrationPaymentFacts): boolean {
  if (facts.invoiceRequested) return facts.invoicePaidAt != null
  return facts.status === 'confirmed' || facts.individualPaymentStatus === 'paid'
}
