import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventsByIds } from '@/lib/sanity'
import { notifyMember } from '@/lib/notify'
import { sendEmail } from '@/lib/email'

// GET /api/cron/training-reminders — runs daily (see vercel.json).
// For each training assignment with a due date, reminds participants who haven't
// finished the module (buckets: 7 days out, 1 day out) and escalates overdue
// MANDATORY training to the group's teacher / Student Manager (FR-COM-10).

const DAY = 24 * 60 * 60_000

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()
  const now = Date.now()

  const { data: assignments } = await db
    .from('training_assignments')
    .select('id, module_id, event_ref, event_role, is_mandatory, due_at')
    .not('due_at', 'is', null)
  if (!assignments?.length) return NextResponse.json({ reminded: 0, escalated: 0 })

  // Resolve event _ids → registration slugs (assignments key off Sanity _id).
  const eventRefs = [...new Set(assignments.map((a) => a.event_ref as string))]
  const events = await getEventsByIds(eventRefs)
  const slugByRef = new Map(events.map((e) => [e._id, e.slug.current]))

  let reminded = 0
  let escalated = 0

  for (const a of assignments) {
    const due = new Date(a.due_at as string).getTime()
    const slug = slugByRef.get(a.event_ref as string)
    if (!slug) continue

    // Bucket selection.
    let bucket: '7d' | '1d' | 'overdue' | null = null
    if (due < now) bucket = 'overdue'
    else if (due <= now + DAY) bucket = '1d'
    else if (due <= now + 7 * DAY) bucket = '7d'
    if (!bucket) continue

    // Module item ids (to measure completion).
    const { data: items } = await db.from('training_items').select('id').eq('module_id', a.module_id)
    const itemIds = (items ?? []).map((i) => i.id as string)
    if (itemIds.length === 0) continue

    // Participants of this event with the assigned role (or 'all').
    const { data: regs } = await db
      .from('registrations')
      .select('id, teacher_email, teacher_first_name')
      .eq('event_slug', slug)
    const regById = new Map((regs ?? []).map((r) => [r.id, r]))
    const regIds = [...regById.keys()]
    if (regIds.length === 0) continue

    let partQ = db
      .from('participants')
      .select('member_id, first_name, last_name, event_role, registration_id')
      .in('registration_id', regIds)
      .not('member_id', 'is', null)
    if (a.event_role !== 'all') partQ = partQ.eq('event_role', a.event_role)
    const { data: participants } = await partQ

    for (const p of participants ?? []) {
      const memberId = p.member_id as string

      // Completion check.
      const { count } = await db
        .from('training_progress')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', memberId)
        .eq('status', 'completed')
        .in('item_id', itemIds)
      if ((count ?? 0) >= itemIds.length) continue // already done

      if (bucket === 'overdue') {
        // Escalate mandatory overdue training to the teacher / Student Manager.
        if (!a.is_mandatory) continue
        const reg = regById.get(p.registration_id)
        const teacherEmail = (reg as { teacher_email?: string } | undefined)?.teacher_email
        if (!teacherEmail) continue
        const { error } = await db
          .from('sent_reminders')
          .insert({ kind: 'training_escalation', ref_id: a.id, member_id: memberId, bucket })
        if (error) continue
        await sendEmail({
          to: teacherEmail,
          subject: 'Mandatory training overdue for a group member',
          html: `<p>Hi ${(reg as { teacher_first_name?: string }).teacher_first_name ?? 'there'},</p><p><strong>${p.first_name} ${p.last_name}</strong> has not completed mandatory training that was due ${new Date(a.due_at as string).toLocaleDateString()}.</p>`,
          text: `${p.first_name} ${p.last_name} has not completed mandatory training due ${new Date(a.due_at as string).toLocaleDateString()}.`,
        })
        escalated++
      } else {
        const { error } = await db
          .from('sent_reminders')
          .insert({ kind: 'training', ref_id: a.id, member_id: memberId, bucket })
        if (error) continue
        await notifyMember(memberId, {
          type: 'session_reminder',
          body: `Training due ${new Date(a.due_at as string).toLocaleDateString()} — you still have lessons to complete.`,
          referenceType: 'training_module',
          referenceId: a.module_id as string,
        })
        reminded++
      }
    }
  }

  return NextResponse.json({ reminded, escalated })
}
