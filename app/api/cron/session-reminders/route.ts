import { NextRequest, NextResponse } from 'next/server'
import { formatDateTime } from '@/lib/utils'
import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'
import { guardCron } from '@/lib/cron'
import { rows } from '@/lib/db'

// GET /api/cron/session-reminders — runs hourly (see vercel.json).
// Reminds participants + hosts of upcoming coaching/mentoring sessions at two
// buckets: 24h out and 1h out (FR-COM-11/12). Idempotent via sent_reminders.

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const now = Date.now()
  const buckets: { bucket: string; fromMs: number; toMs: number }[] = [
    { bucket: '24h', fromMs: now + 60 * 60_000, toMs: now + 24 * 60 * 60_000 },
    { bucket: '1h', fromMs: now, toMs: now + 60 * 60_000 },
  ]

  let sent = 0

  for (const b of buckets) {
    // deep review QUAL-6: these reads decide whether anyone gets reminded. Read
    // via rows(), which throws on a PostgREST error instead of resolving to an
    // empty list — so a transient outage fails the cron run (recorded, retried
    // next hour; sends are idempotent via sent_reminders) rather than reporting
    // `sent: 0` and leaving cron_runs looking healthy while nobody was reminded.
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

  return NextResponse.json({ sent })
}
