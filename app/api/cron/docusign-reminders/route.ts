import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resendEnvelope, type AgreementType } from '@/lib/docusign'
import { AGREEMENT_LABEL } from '@/lib/docusign-agreements'
import { sendEmail, docusignReminderToMinorEmail, docusignReminderToSignerEmail } from '@/lib/email'

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
    .select('id, envelope_id, envelope_type, minor_name, signer_name, event_title, member_id')
    .in('status', ['sent', 'delivered'])
    .lt('sent_at', sevenDaysAgo)
    .is('reminder_sent_at', null)

  if (!envelopes?.length) return NextResponse.json({ processed: 0 })

  // Prefetch all minor-participant emails in one query instead of one per envelope
  const memberIds = [...new Set(envelopes.map(e => e.member_id).filter(Boolean))]
  const { data: members } = memberIds.length > 0
    ? await db.from('members').select('id, email, first_name').in('id', memberIds)
    : { data: [] }
  const memberById = new Map((members ?? []).map(m => [m.id, m]))

  // Resends stay sequential: parallel calls risk DocuSign rate limits, and the
  // per-envelope reminder_sent_at update keeps the job resumable if it dies mid-run.
  let processed = 0
  for (const env of envelopes) {
    try {
      await resendEnvelope(env.envelope_id)

      const member = env.member_id ? memberById.get(env.member_id) : null
      if (member) {
        const type = (env.envelope_type ?? 'minor') as AgreementType
        const content = type === 'minor'
          ? docusignReminderToMinorEmail({
              firstName:    member.first_name,
              guardianName: env.signer_name,
              eventTitle:   env.event_title,
            })
          : docusignReminderToSignerEmail({
              firstName:      member.first_name,
              eventTitle:     env.event_title,
              agreementLabel: AGREEMENT_LABEL[type],
            })
        await sendEmail({ to: member.email, ...content })
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
