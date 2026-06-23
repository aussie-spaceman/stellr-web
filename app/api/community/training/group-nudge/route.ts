import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { notifyMember } from '@/lib/notify'

// POST /api/community/training/group-nudge
// Body: { memberIds: string[], objectRef: string, objectLabel?: string }
// A Teacher nudges students in their group to complete required training. Only
// students registered under THIS teacher (teacher_email) for the given Object can
// be nudged — the request is intersected with that set server-side.
export async function POST(req: Request) {
  const teacher = await getCurrentMember()
  if (!teacher) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (teacher.event_role !== 'teacher') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { memberIds, objectRef, objectLabel } = await req.json().catch(() => ({}))
  if (!Array.isArray(memberIds) || memberIds.length === 0 || !objectRef) {
    return NextResponse.json({ error: 'memberIds and objectRef required' }, { status: 400 })
  }

  const db = supabaseServer()
  // Registrations this teacher owns for the Object.
  const { data: regs } = await db
    .from('registrations')
    .select('id')
    .eq('event_slug', objectRef)
    .eq('teacher_email', teacher.email)
  const regIds = (regs ?? []).map((r) => r.id as string)
  if (regIds.length === 0) return NextResponse.json({ error: 'No group found' }, { status: 403 })

  // Students actually in the teacher's group.
  const { data: parts } = await db
    .from('participants')
    .select('member_id')
    .in('registration_id', regIds)
    .not('member_id', 'is', null)
  const allowed = new Set((parts ?? []).map((p) => p.member_id as string))
  const targets = (memberIds as string[]).filter((id) => allowed.has(id))
  if (targets.length === 0) return NextResponse.json({ error: 'No matching students' }, { status: 403 })

  const label = typeof objectLabel === 'string' && objectLabel ? objectLabel : 'your event'
  await Promise.all(
    targets.map((memberId) =>
      notifyMember(memberId, {
        type: 'session_reminder',
        body: `Reminder from your teacher: please complete your required training for ${label}.`,
        email: {
          subject: 'Required training reminder',
          html: `<p>Hi,</p><p>This is a reminder from your teacher to complete your required training for <strong>${label}</strong>. Sign in to Stellr and head to Academy &rsaquo; Training.</p>`,
          text: `Reminder from your teacher: complete your required training for ${label}.`,
        },
      })
    )
  )

  return NextResponse.json({ nudged: targets.length })
}
