import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'

// GET /api/cron/session-reminders — runs hourly (see vercel.json).
// Reminds participants + hosts of upcoming coaching/mentoring sessions at two
// buckets: 24h out and 1h out (FR-COM-11/12). Idempotent via sent_reminders.

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()
  const now = Date.now()
  const buckets: { bucket: string; fromMs: number; toMs: number }[] = [
    { bucket: '24h', fromMs: now + 60 * 60_000, toMs: now + 24 * 60 * 60_000 },
    { bucket: '1h', fromMs: now, toMs: now + 60 * 60_000 },
  ]

  let sent = 0

  for (const b of buckets) {
    const { data: sessions } = await db
      .from('sessions')
      .select('id, title, scheduled_start, host_member_id')
      .eq('status', 'scheduled')
      .gte('scheduled_start', new Date(b.fromMs).toISOString())
      .lte('scheduled_start', new Date(b.toMs).toISOString())

    for (const s of sessions ?? []) {
      const { data: parts } = await db
        .from('session_participants')
        .select('member_id')
        .eq('session_id', s.id)
      const recipients = new Set<string>((parts ?? []).map((p) => p.member_id as string))
      if (s.host_member_id) recipients.add(s.host_member_id as string)

      for (const memberId of recipients) {
        // Dedupe: skip if we've already sent this bucket for this session+member.
        const { error: insErr } = await db
          .from('sent_reminders')
          .insert({ kind: 'session', ref_id: s.id, member_id: memberId, bucket: b.bucket })
        if (insErr) continue // unique violation → already reminded

        await notifyMember(memberId, {
          type: 'session_reminder',
          body: `Reminder: "${s.title ?? 'session'}" starts ${new Date(s.scheduled_start).toLocaleString()}.`,
          referenceType: 'session',
          referenceId: s.id,
        })
        sent++
      }
    }
  }

  return NextResponse.json({ sent })
}
