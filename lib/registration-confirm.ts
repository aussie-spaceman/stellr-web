import { supabaseServer } from '@/lib/supabase'
import { sendEmail, individualConfirmationEmail, groupPaymentConfirmedEmail } from '@/lib/email'
import { finalizeRegistrationMerch } from '@/lib/store/event-merch'

// Marks a registration confirmed and sends the confirmation email. Moved out of
// the Stripe webhook (unchanged) so a 100% scholarship, which never reaches
// Stripe, confirms through exactly the same steps as a paid checkout.
export async function confirmRegistration(
  registrationId: string,
  isGroup: boolean,
  opts: { paidViaInvoice?: boolean } = {},
) {
  const db = supabaseServer()

  // For invoice-settled registrations, `status='confirmed'` alone is NOT proof of
  // payment — `registrationPaid()` requires `invoice_paid_at` for any reg with
  // invoice_requested. Stamp it here so paying a Stripe invoice online reconciles
  // every paid surface (roster pills, Teams tab, billing, access gates) without an
  // admin having to hit /api/admin/events/[slug]/invoice-paid manually.
  const update: { status: string; invoice_paid_at?: string } = { status: 'confirmed' }
  if (opts.paidViaInvoice) update.invoice_paid_at = new Date().toISOString()
  await db.from('registrations').update(update).eq('id', registrationId)

  // Finalize event merch: allocate the included shirt to every participant
  // (sized from their t-shirt size) and activate any paid add-ons. Idempotent + non-fatal.
  await finalizeRegistrationMerch(db, registrationId)

  if (isGroup) {
    const { data: reg } = await db.from('registrations')
      .select('event_title, teacher_first_name, teacher_email')
      .eq('id', registrationId).maybeSingle()

    if (reg) {
      const r = reg as { event_title: string; teacher_first_name: string | null; teacher_email: string | null }
      if (r.teacher_email) {
        const emailContent = groupPaymentConfirmedEmail({
          teacherFirstName: r.teacher_first_name ?? 'there',
          eventTitle: r.event_title,
          registrationId,
        })
        await sendEmail({ to: r.teacher_email, ...emailContent })
      }
    }
  } else {
    const { data: participant } = await db.from('participants')
      .select('first_name, last_name, email, membership_id')
      .eq('registration_id', registrationId).maybeSingle()

    const { data: reg } = await db.from('registrations')
      .select('event_title').eq('id', registrationId).maybeSingle()

    if (participant && reg) {
      const p = participant as { first_name: string; last_name: string; email: string; membership_id: string }
      const r = reg as { event_title: string }
      const emailContent = individualConfirmationEmail({
        firstName: p.first_name, lastName: p.last_name,
        membershipId: p.membership_id, eventTitle: r.event_title,
        registrationId,
      })
      await sendEmail({ to: p.email, ...emailContent })
    }
  }
}
