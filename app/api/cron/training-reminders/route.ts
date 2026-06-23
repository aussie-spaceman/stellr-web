import { NextRequest, NextResponse } from 'next/server'
import { formatDateShort } from '@/lib/utils'
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

  // Per-course reminder & escalation settings (Reminders & escalation tab). The
  // schedule toggles gate which buckets fire; channels gate whether to remind at
  // all; escalate_supervisor gates teacher/SM escalation.
  const moduleIds = [...new Set(assignments.map((a) => a.module_id as string))]
  const { data: settingsRows } = await db
    .from('training_modules')
    .select('id, remind_inapp, remind_email, remind_sms, remind_2wk, remind_1wk, remind_2d, remind_1d, escalate_supervisor')
    .in('id', moduleIds)
  type Settings = {
    remind_inapp: boolean; remind_email: boolean; remind_sms: boolean
    remind_2wk: boolean; remind_1wk: boolean; remind_2d: boolean; remind_1d: boolean
    escalate_supervisor: boolean
  }
  const settingsById = new Map<string, Settings>((settingsRows ?? []).map((s) => [s.id as string, s as unknown as Settings]))
  const DEFAULTS: Settings = {
    remind_inapp: true, remind_email: true, remind_sms: false,
    remind_2wk: false, remind_1wk: true, remind_2d: false, remind_1d: true,
    escalate_supervisor: true,
  }

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

    const s = settingsById.get(a.module_id as string) ?? DEFAULTS

    // Bucket selection — gated by the course's enabled schedule toggles. The
    // sent_reminders unique key (kind, ref_id, member_id, bucket) prevents dupes.
    let bucket: '2wk' | '1wk' | '2d' | '1d' | 'overdue' | null = null
    if (due < now) bucket = 'overdue'
    else if (s.remind_1d && due <= now + DAY) bucket = '1d'
    else if (s.remind_2d && due <= now + 2 * DAY) bucket = '2d'
    else if (s.remind_1wk && due <= now + 7 * DAY) bucket = '1wk'
    else if (s.remind_2wk && due <= now + 14 * DAY) bucket = '2wk'
    if (!bucket) continue

    // A reminder needs at least one delivery channel enabled; escalation is gated
    // separately by escalate_supervisor.
    const anyChannel = s.remind_inapp || s.remind_email || s.remind_sms
    if (bucket !== 'overdue' && !anyChannel) continue

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
        // Escalate mandatory overdue training to the teacher / Student Manager,
        // unless the course has escalation switched off.
        if (!a.is_mandatory || !s.escalate_supervisor) continue
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
          html: `<p>Hi ${(reg as { teacher_first_name?: string }).teacher_first_name ?? 'there'},</p><p><strong>${p.first_name} ${p.last_name}</strong> has not completed mandatory training that was due ${formatDateShort(a.due_at as string)}.</p>`,
          text: `${p.first_name} ${p.last_name} has not completed mandatory training due ${formatDateShort(a.due_at as string)}.`,
        })
        escalated++
      } else {
        const { error } = await db
          .from('sent_reminders')
          .insert({ kind: 'training', ref_id: a.id, member_id: memberId, bucket })
        if (error) continue
        await notifyMember(memberId, {
          type: 'session_reminder',
          body: `Training due ${formatDateShort(a.due_at as string)} — you still have lessons to complete.`,
          referenceType: 'training_module',
          referenceId: a.module_id as string,
        })
        reminded++
      }
    }
  }

  return NextResponse.json({ reminded, escalated })
}
