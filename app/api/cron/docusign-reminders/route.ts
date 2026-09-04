import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resendEnvelope, type AgreementType } from '@/lib/docusign'
import { AGREEMENT_LABEL } from '@/lib/docusign-agreements'
import { syncEnvelopeRecipients } from '@/lib/docusign-recipients'
import { describeEnvelope, roleLabel } from '@/lib/docusign-status'
import {
  sendEmail,
  docusignReminderToMinorEmail,
  docusignReminderToSignerEmail,
  docusignSentToGuardianEmail,
} from '@/lib/email'

// GET /api/cron/docusign-reminders
// Vercel cron calls this daily at 09:00 UTC (see vercel.json).
//
// Chases unsigned envelopes. Two behaviours changed on 4 Sept 2026:
//
// 1. It used to filter on `reminder_sent_at IS NULL`, and both this cron AND the
//    admin resend route write that column — so every envelope was chased at most
//    ONCE, ever, and an admin pressing "Resend" silently removed that envelope
//    from automated chasing for good. It now re-chases on an interval up to a
//    cap, and the admin resend writes `last_manual_resend_at` instead.
//
// 2. It used to assert that the guardian was the holdout without checking. The
//    consent form carries two signature blocks; when the student's was the one
//    outstanding, the family was told the opposite of the truth. Copy is now
//    driven by the recipients who are actually outstanding.

const FIRST_CHASE_AFTER_DAYS = 7
const CHASE_INTERVAL_DAYS = 7
/** Stop after this many automated chases; beyond it a human should intervene. */
const MAX_CHASES = 4

const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()
  const firstChaseCutoff = new Date(Date.now() - FIRST_CHASE_AFTER_DAYS * DAY_MS).toISOString()
  const repeatChaseCutoff = new Date(Date.now() - CHASE_INTERVAL_DAYS * DAY_MS).toISOString()

  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, envelope_type, minor_name, signer_name, signer_email, event_title, member_id, status, signers_total, signers_completed, reused_from, reminder_count')
    .in('status', ['sent', 'delivered'])
    .lt('sent_at', firstChaseCutoff)
    .lt('reminder_count', MAX_CHASES)
    // Never chased, or last chased more than CHASE_INTERVAL_DAYS ago.
    .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${repeatChaseCutoff}`)

  if (!envelopes?.length) return NextResponse.json({ processed: 0 })

  // Prefetch all participant emails in one query instead of one per envelope
  const memberIds = [...new Set(envelopes.map(e => e.member_id).filter(Boolean))]
  const { data: members } = memberIds.length > 0
    ? await db.from('members').select('id, email, first_name').in('id', memberIds)
    : { data: [] }
  const memberById = new Map((members ?? []).map(m => [m.id, m]))

  // Resends stay sequential: parallel calls risk DocuSign rate limits, and the
  // per-envelope reminder bookkeeping keeps the job resumable if it dies mid-run.
  let processed = 0
  let skippedBounced = 0
  for (const env of envelopes) {
    try {
      // Refresh recipients first: the copy below depends on who is actually
      // outstanding, and a stale list would reproduce the exact bug this fixes.
      let recipients: Awaited<ReturnType<typeof syncEnvelopeRecipients>> = []
      try {
        recipients = await syncEnvelopeRecipients(db, env.id, env.envelope_id)
      } catch (err) {
        console.error(`[cron] docusign-reminders: recipient sync failed for ${env.id}:`, err)
      }

      const description = describeEnvelope(
        {
          status: env.status,
          signers_total: env.signers_total,
          signers_completed: env.signers_completed,
          reused_from: env.reused_from,
        },
        recipients.map(r => ({
          name: r.name, email: r.email, role_name: r.roleName,
          status: r.status, delivered_at: r.deliveredAt,
        })),
      )

      // Completed between the query and now — nothing to chase.
      if (description.pill === 'complete' || description.pill === 'on_file') continue

      // A bounced address will never receive a resend. Chasing it burns a slot
      // and tells the family to watch an inbox that cannot receive the mail;
      // alertOnNewBounces has already put this in front of an admin.
      if (description.pill === 'bounced') {
        skippedBounced++
        continue
      }

      await resendEnvelope(env.envelope_id)

      const type = (env.envelope_type ?? 'minor') as AgreementType
      const member = env.member_id ? memberById.get(env.member_id) : null

      if (member) {
        const content = type === 'minor'
          ? docusignReminderToMinorEmail({
              firstName:  member.first_name,
              eventTitle: env.event_title,
              waitingOn:  description.waitingOn.map(r => ({
                name: r.name || r.email,
                role: roleLabel(r.role_name),
                neverOpened: !r.delivered_at,
              })),
            })
          : docusignReminderToSignerEmail({
              firstName:      member.first_name,
              eventTitle:     env.event_title,
              agreementLabel: AGREEMENT_LABEL[type],
            })
        await sendEmail({ to: member.email, ...content })
      }

      // Chase the outstanding guardian directly too. Previously only the student
      // was emailed and asked to relay the message to their parent — which fails
      // completely when the student is a minor who does not read that inbox.
      if (type === 'minor') {
        const guardian = description.waitingOn.find(r => (r.role_name ?? '').toLowerCase() === 'guardian')
        if (guardian?.email) {
          await sendEmail({
            to: guardian.email,
            ...docusignSentToGuardianEmail({
              guardianName: guardian.name || env.signer_name,
              minorName:    env.minor_name,
              eventTitle:   env.event_title,
              isReminder:   true,
            }),
          })
        }
      }

      const now = new Date().toISOString()
      await db
        .from('docusign_envelopes')
        .update({
          reminder_sent_at: now,
          reminder_count: (env.reminder_count ?? 0) + 1,
          updated_at: now,
        })
        .eq('id', env.id)

      processed++
    } catch (err) {
      console.error(`[cron] docusign-reminders: failed for envelope ${env.id}:`, err)
    }
  }

  console.log(`[cron] docusign-reminders: processed ${processed} of ${envelopes.length} (${skippedBounced} skipped — bounced address)`)
  return NextResponse.json({ processed, skippedBounced })
}
