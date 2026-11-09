import { z } from 'zod'

// The body both payment-method routes accept (admin roster and Account → Teams).
// Kept apart from lib/group-payment-change.ts so a route can parse it without
// loading Stripe and the billing code.

/** The body both payment-method routes accept: `{ method, invoiceParticipantIds?, lateJoinerPayer? }`. */
export const paymentChangeBody = z.object({
  method: z.enum(['invoice', 'invoice_some', 'teacher_share', 'card', 'individual']),
  invoiceParticipantIds: z.array(z.string().uuid()).max(500).optional(),
  lateJoinerPayer: z.enum(['group', 'self']).optional(),
  /** "Students share the teacher's cost": how many students the teacher expects. */
  shareEstimate: z.number().int().min(1).max(200).optional(),
}).refine((b) => b.method !== 'invoice_some' || (b.invoiceParticipantIds && b.lateJoinerPayer), {
  message: 'Tick who goes on the invoice, and say how people who join later pay.',
}).refine((b) => b.method !== 'teacher_share' || b.shareEstimate != null, {
  message: 'Say how many students you expect to bring.',
})

