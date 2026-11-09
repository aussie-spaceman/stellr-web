import type { SupabaseClient } from '@supabase/supabase-js'
import { announceBounces } from '@/lib/esign/bounce-notices'

// Resend tells us when a Stellr signing email bounced. DocuSign shows that as
// "Email Bounced" (its 'autoresponded' recipient status); Stellr signing now
// does the same, so the roster pill and the admin table read alike for both
// engines. Only signing invitations are acted on: they are the emails whose
// Resend id is stored on a signer (invite_email_id). Everything else Resend
// reports (pay links, receipts) is ignored here.
//
// Who is told, and what they see, is lib/esign/bounce-notices.ts: one notice
// per form, so each form's own group and other signer hear about it.

export interface ResendEvent {
  type: string
  data?: { email_id?: string; to?: string[]; bounce?: { message?: string; type?: string } }
}

export async function handleResendEvent(db: SupabaseClient, event: ResendEvent): Promise<{ bounced: number }> {
  if (event.type !== 'email.bounced' || !event.data?.email_id) return { bounced: 0 }

  // One email can carry several forms (a parent's siblings), so several rows.
  const { data: rows, error } = await db
    .from('agreement_recipients')
    .update({
      status: 'autoresponded',
      invite_error: `Bounced${event.data.bounce?.message ? `: ${event.data.bounce.message}` : ''}`.slice(0, 500),
      last_synced_at: new Date().toISOString(),
    })
    .eq('invite_email_id', event.data.email_id)
    .in('status', ['sent', 'delivered'])
    .select('id, envelope_row')
  if (error) throw new Error(`Recording the bounce failed: ${error.message}`)
  if (!rows?.length) return { bounced: 0 }

  for (const envelopeRow of new Set(rows.map((r) => r.envelope_row as string))) {
    await announceBounces(db, envelopeRow, { kind: 'bounced' })
  }
  return { bounced: rows.length }
}
