import { NextRequest, NextResponse } from 'next/server'
import { formatDateTime } from '@/lib/utils'
import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { rows } from '@/lib/db'

// GET /api/cron/session-reminders — runs hourly (see vercel.json).
// Reminds participants + hosts of upcoming coaching/mentoring sessions at two
// buckets: 24h out and 1h out (FR-COM-11/12). Idempotent via sent_reminders.

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  // deep review INT-9: record the run so a failing reminder cron is visible.
  const run = await startCronRun(db, 'session-reminders')
  const now = Date.now()
  const buckets: { bucket: string; fromMs: number; toMs: number }[] = [
    { bucket: '24h', fromMs: now + 60 * 60_000, toMs: now + 24 * 60 * 60_000 },
    { bucket: '1h', fromMs: now, toMs: now + 60 * 60_000 },
  ]

  let sent = 0

  try {
    for (const b of buckets) {
      // deep review QUAL-6: these reads decide whether anyone gets reminded. Read
      // via rows(), which throws on a PostgREST error instead of resolving to an
      // empty list — so a transient outage fails the cron run (recorded below via
      // run.fail, retried next hour; sends are idempotent via sent_reminders)
      // rather than reporting `sent: 0` while cron_runs looks healthy.
      const sessions = await rows<{ id: string; title: string | null; scheduled_start: string; host_member_id: string | null }>(
        db
          .from('sessions')
          .select('id, title, scheduled_start, host_member_id')
          .eq('status', 'scheduled')
          .gte('scheduled_start', new Date(b.fromMs).toISOString())
          .lte('scheduled_start', new Date(b.toMs).toISOString()),
        'session-reminders: upcoming sessions',
      )

      for (const s of sessions) {
        const parts = await rows<{ member_id: string }>(
          db.from('session_participants').select('member_id').eq('session_id', s.id),
          'session-reminders: session participants',
        )
        const recipients = new Set<string>(parts.map((p) => p.member_id))
        if (s.host_member_id) recipients.add(s.host_member_id as string)

        for (const memberId of recipients) {
          // Dedupe: skip if we've already sent this bucket for this session+member.
          const { error: insErr } = await db
            .from('sent_reminders')
            .insert({ kind: 'session', ref_id: s.id, member_id: memberId, bucket: b.bucket })
          if (insErr) continue // unique violation → already reminded

          await notifyMember(memberId, {
            type: 'session_reminder',
            body: `Reminder: "${s.title ?? 'session'}" starts ${formatDateTime(s.scheduled_start)}.`,
            referenceType: 'session',
            referenceId: s.id,
          })
          sent++
        }
      }
    }
  } catch (e) {
    // deep review INT-9 + QUAL-6: a read that threw must fail the recorded run,
    // not escape as a silent 500 with the cron_runs row left open.
    const msg = e instanceof Error ? e.message : String(e)
    run.fail('session-reminders: read', msg)
    await run.finish({ sent })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  await run.finish({ sent })
  return NextResponse.json({ sent })
}
