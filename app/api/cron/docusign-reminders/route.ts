import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resendEnvelope } from '@/lib/docusign'
import { sendEmail, docusignReminderToMinorEmail } from '@/lib/email'

// GET /api/cron/docusign-reminders
// Vercel cron calls this daily at 09:00 UTC (see vercel.json).
// Finds unsigned envelopes older than 7 days with no reminder sent,
// resends via DocuSign, and emails the minor participant.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, minor_name, signer_name, event_title, member_id')
    .in('status', ['sent', 'delivered'])
    .lt('sent_at', sevenDaysAgo)
    .is('reminder_sent_at', null)

  if (!envelopes?.length) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const env of envelopes) {
    try {
      await resendEnvelope(env.envelope_id)

      if (env.member_id) {
        const { data: member } = await db
          .from('members')
          .select('email, first_name')
          .eq('id', env.member_id)
          .maybeSingle()

        if (member) {
          const content = docusignReminderToMinorEmail({
            firstName:    member.first_name,
            guardianName: env.signer_name,
            eventTitle:   env.event_title,
          })
          await sendEmail({ to: member.email, ...content })
        }
      }

      await db
        .from('docusign_envelopes')
        .update({ reminder_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', env.id)

      processed++
    } catch (err) {
      console.error(`[cron] docusign-reminders: failed for envelope ${env.id}:`, err)
    }
  }

  console.log(`[cron] docusign-reminders: processed ${processed} of ${envelopes.length}`)
  return NextResponse.json({ processed })
}
