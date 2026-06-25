import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import {
  isCohortMentor,
  linkCohortTraining,
  unlinkCohortTraining,
  scheduleCoachingSeries,
  rescheduleSession,
  hostRespond,
} from '@/lib/sessions'
import { assignCohortAction, attachCohortResource, detachCohortResource, searchAttachableResources } from '@/lib/mentoring'

// GET — resource-library search for the coach's "Assign material" picker.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const workshopId = searchParams.get('workshopId') ?? ''
  if (!workshopId || (!member.isAdmin && !(await isCohortMentor(workshopId, member.id)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const results = await searchAttachableResources(searchParams.get('q') ?? '')
  return NextResponse.json({ results })
}

// POST /api/community/coaching/manage — the workshop's coach configures it:
// schedule sessions, assign training material, assign actions to the member.
// Body: { workshopId, action, ...payload }. Coach-gated by isCohortMentor.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  // Accept either workshopId or cohortId (the shared modals post cohortId).
  const workshopId: string | undefined = b.workshopId ?? b.cohortId
  if (!workshopId) return NextResponse.json({ error: 'workshopId required' }, { status: 400 })
  if (!member.isAdmin && !(await isCohortMentor(workshopId, member.id))) {
    return NextResponse.json({ error: 'Only the workshop coach can manage it.' }, { status: 403 })
  }

  switch (b.action) {
    case 'linkTraining': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      await linkCohortTraining(workshopId, b.moduleId, !!b.mandatory, b.dueAt || null)
      return NextResponse.json({ ok: true })
    }
    case 'unlinkTraining': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      await unlinkCohortTraining(workshopId, b.moduleId)
      return NextResponse.json({ ok: true })
    }
    case 'scheduleSeries': {
      if (!b.startIso) return NextResponse.json({ error: 'startIso required' }, { status: 400 })
      // The workshop coach hosts the sessions; an admin acting on their behalf uses
      // the assigned coach as host.
      const coachId = member.isAdmin && !(await isCohortMentor(workshopId, member.id)) ? await coachOf(workshopId) : member.id
      if (!coachId) return NextResponse.json({ error: 'No coach assigned' }, { status: 400 })
      const r = await scheduleCoachingSeries(
        coachId,
        workshopId,
        b.startIso,
        Number(b.count) || 1,
        Number(b.intervalDays) || 7,
        Number(b.durationMin) || 60,
        b.title || undefined,
      )
      if (!r.ok) return NextResponse.json({ error: r.error ?? 'Could not schedule' }, { status: 400 })
      return NextResponse.json({ ok: true, created: r.created })
    }
    case 'rescheduleSession': {
      if (!b.sessionId || !b.startIso) return NextResponse.json({ error: 'sessionId and startIso required' }, { status: 400 })
      const coachId = await coachOf(workshopId)
      if (!coachId) return NextResponse.json({ error: 'No coach assigned' }, { status: 400 })
      const ok = await rescheduleSession(b.sessionId, coachId, b.startIso, { durationMin: Number(b.durationMin) || undefined, title: b.title ?? undefined })
      if (!ok) return NextResponse.json({ error: 'Could not reschedule' }, { status: 400 })
      return NextResponse.json({ ok: true })
    }
    case 'cancelSession': {
      if (!b.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
      const coachId = await coachOf(workshopId)
      if (!coachId) return NextResponse.json({ error: 'No coach assigned' }, { status: 400 })
      const ok = await hostRespond(b.sessionId, coachId, 'cancelled')
      if (!ok) return NextResponse.json({ error: 'Could not cancel' }, { status: 400 })
      return NextResponse.json({ ok: true })
    }
    case 'assignAction': {
      if (!b.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
      // 1-on-1: always the single member (empty memberIds → all active = the one).
      const n = await assignCohortAction(workshopId, member.id, {
        title: b.title,
        memberIds: [],
        dueDate: b.dueDate || null,
        trainingModuleId: b.trainingModuleId || null,
        remindBeforeHours: b.remind ? 24 : null,
      })
      return NextResponse.json({ ok: true, assigned: n })
    }
    case 'attachResource': {
      if (!b.resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 })
      await attachCohortResource(workshopId, b.resourceId, !!b.mandatory, b.dueAt || null)
      return NextResponse.json({ ok: true })
    }
    case 'detachResource': {
      if (!b.resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 })
      await detachCohortResource(workshopId, b.resourceId)
      return NextResponse.json({ ok: true })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

async function coachOf(workshopId: string): Promise<string | null> {
  const { supabaseServer } = await import('@/lib/supabase')
  const db = supabaseServer()
  const { data } = await db.from('mentoring_cohorts').select('mentor_member_id').eq('id', workshopId).maybeSingle()
  return (data?.mentor_member_id as string | null) ?? null
}
