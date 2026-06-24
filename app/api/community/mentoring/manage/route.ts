import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import {
  isCohortMentor,
  linkCohortTraining,
  unlinkCohortTraining,
  scheduleMentoringSeries,
  inviteMembersToCohort,
} from '@/lib/sessions'
import { assignCohortAction, attachCohortResource, detachCohortResource, searchAttachableResources } from '@/lib/mentoring'

// GET — resource-library search for the "Attach a resource" picker (mentor/admin).
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const cohortId = searchParams.get('cohortId') ?? ''
  if (!cohortId || (!member.isAdmin && !(await isCohortMentor(cohortId, member.id)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const results = await searchAttachableResources(searchParams.get('q') ?? '')
  return NextResponse.json({ results })
}

// POST /api/community/mentoring/manage — a cohort's mentor configures it
// (PRD §11): assign training material, and schedule a session series.
// Body: { cohortId, action, ...payload }. Mentor-gated by isCohortMentor.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
  if (!member.isAdmin && !(await isCohortMentor(b.cohortId, member.id))) {
    return NextResponse.json({ error: 'Only the cohort mentor can manage it.' }, { status: 403 })
  }

  switch (b.action) {
    case 'linkTraining': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      await linkCohortTraining(b.cohortId, b.moduleId, !!b.mandatory, b.dueAt || null)
      return NextResponse.json({ ok: true })
    }
    case 'unlinkTraining': {
      if (!b.moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
      await unlinkCohortTraining(b.cohortId, b.moduleId)
      return NextResponse.json({ ok: true })
    }
    case 'scheduleSeries': {
      if (!b.startIso) return NextResponse.json({ error: 'startIso required' }, { status: 400 })
      const r = await scheduleMentoringSeries(
        member.id,
        b.cohortId,
        b.startIso,
        Number(b.count) || 1,
        Number(b.intervalDays) || 7,
        Number(b.durationMin) || 60,
        b.title || undefined,
      )
      if (!r.ok) return NextResponse.json({ error: r.error ?? 'Could not schedule' }, { status: 400 })
      return NextResponse.json({ ok: true, created: r.created })
    }
    case 'assignAction': {
      if (!b.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
      const n = await assignCohortAction(b.cohortId, member.id, {
        title: b.title,
        memberIds: Array.isArray(b.memberIds) ? b.memberIds : [],
        dueDate: b.dueDate || null,
        trainingModuleId: b.trainingModuleId || null,
        remindBeforeHours: b.remind ? 24 : null,
      })
      return NextResponse.json({ ok: true, assigned: n })
    }
    case 'attachResource': {
      if (!b.resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 })
      await attachCohortResource(b.cohortId, b.resourceId, !!b.mandatory, b.dueAt || null)
      return NextResponse.json({ ok: true })
    }
    case 'detachResource': {
      if (!b.resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 })
      await detachCohortResource(b.cohortId, b.resourceId)
      return NextResponse.json({ ok: true })
    }
    case 'invite': {
      const ids = Array.isArray(b.memberIds) ? b.memberIds : []
      if (ids.length === 0) return NextResponse.json({ error: 'memberIds required' }, { status: 400 })
      const n = await inviteMembersToCohort(b.cohortId, ids)
      return NextResponse.json({ ok: true, invited: n })
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
