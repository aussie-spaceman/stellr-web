// ── The 100% money-back guarantee, as customers see it ───────────────────────
// The rule is in lib/refunds/policy.ts; the binding wording is Terms §9.1. This
// is the wording every payment surface repeats: the badge, Stripe's own
// checkout page, and receipts. Client-safe.

import { GUARANTEE_DAYS } from '@/lib/refunds/policy'

export { GUARANTEE_DAYS }

/** The Terms section, absolute so it works from the member app and from emails. */
export const GUARANTEE_TERMS_URL = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'}/terms#guarantee`

/** Where refund requests go (Terms §9.1: "by email"). */
export const REFUND_EMAIL = 'hello@stellreducation.org'

/**
 * Stripe Checkout Session and Payment Link `custom_text`: shown directly above
 * the Pay button, the moment people hesitate. Stripe allows 1,200 characters.
 */
export const GUARANTEE_CHECKOUT_TEXT = {
  submit: {
    message: `100% money-back guarantee: email ${REFUND_EMAIL} within ${GUARANTEE_DAYS} days of payment for a full refund. No questions asked.`,
  },
}

/** One sentence for receipts and confirmation emails. */
export const GUARANTEE_RECEIPT_LINE = `Covered by our 100% money-back guarantee: email ${REFUND_EMAIL} within ${GUARANTEE_DAYS} days of payment for a full refund, no questions asked.`
