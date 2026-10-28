// ── The refund rule: the 100% money-back guarantee ───────────────────────────
// Terms §9.1 (27 Oct 2026): any purchase can be refunded in full within 45 days
// of payment, whether or not the event has happened. After that, nothing is
// refunded. It replaced the per-event "days before the event" schedules
// (refund_policies, migration 027), which nothing reads any more.
//
// Pure: a payment date and an amount in, the refund owed out. The payment date
// is the Stripe charge's (lib/refunds/stripe-state.ts).

export const GUARANTEE_DAYS = 45

export interface RefundOption {
  pct: number
  cents: number
}

export interface RefundOptions {
  cash?: RefundOption
}

/** Whole days since the payment (floored, never negative). */
export function daysSincePayment(paidAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - paidAt.getTime()) / 86_400_000))
}

/** Inside the window, the 45th day included. An unknown payment date is not. */
export function withinGuarantee(paidAt: Date | null, now: Date = new Date()): boolean {
  return paidAt != null && daysSincePayment(paidAt, now) <= GUARANTEE_DAYS
}

/** The full refund the guarantee owes on `refundBasisCents`, or nothing outside the window. */
export function guaranteeRefundOptions(paidAt: Date | null, refundBasisCents: number, now: Date = new Date()): RefundOptions {
  if (refundBasisCents <= 0 || !withinGuarantee(paidAt, now)) return {}
  return { cash: { pct: 100, cents: refundBasisCents } }
}
