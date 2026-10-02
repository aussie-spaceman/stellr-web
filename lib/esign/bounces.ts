import type { SupabaseClient } from '@supabase/supabase-js'
import { maskEmail } from '@/lib/utils'
import { notifyCommunityAdmins } from '@/lib/notify'

// Resend tells us when a Stellr signing email bounced. DocuSign shows that as
// "Email Bounced" (its 'autoresponded' recipient status); Stellr signing now
// does the same, so the roster pill and the admin table read alike for both
// engines. Only signing invitations are acted on: they are the emails whose
// Resend id is stored on a signer (invite_email_id). Everything else Resend
// reports (pay links, receipts) is ignored here.

export interface ResendEvent {
  type: string
  data?: { email_id?: string; to?: string[]; bounce?: { message?: string; type?: string } }
}

export async function handleResendEvent(db: SupabaseClient, event: ResendEvent): Promise<{ bounced: number }> {
  if (event.type !== 'email.bounced' || !event.data?.email_id) return { bounced: 0 }

  // One email can carry several forms (a parent's siblings), so several rows.
  const { data: rows, error } = await db
    .from('docusign_envelope_recipients')
    .update({
      status: 'autoresponded',
      invite_error: `Bounced${event.data.bounce?.message ? `: ${event.data.bounce.message}` : ''}`.slice(0, 500),
      last_synced_at: new Date().toISOString(),
    })
    .eq('invite_email_id', event.data.email_id)
    .in('status', ['sent', 'delivered'])
    .select('id, email, envelope_row')
  if (error) throw new Error(`Recording the bounce failed: ${error.message}`)
  if (!rows?.length) return { bounced: 0 }

  const { data: env } = await db
    .from('docusign_envelopes')
    .select('event_title, minor_name, signer_name')
    .eq('id', rows[0].envelope_row as string)
    .maybeSingle()
  const about = env?.minor_name || env?.signer_name || 'a participant'
  const body = `A Stellr signing email to ${maskEmail(rows[0].email as string)} bounced (${rows.length > 1 ? `${rows.length} forms` : 'the form'} for ${about}${env?.event_title ? `, ${env.event_title}` : ''}). Correct the address on the event roster and send it again.`
  await notifyCommunityAdmins({
    type: 'action',
    body,
    email: { subject: 'A signing email bounced', html: `<p>${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`, text: body },
  }).catch(() => {})
  return { bounced: rows.length }
}
