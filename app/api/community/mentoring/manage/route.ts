import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import {
  isCohortMentor,
  linkCohortTraining,
  unlinkCohortTraining,
  scheduleMentoringSeries,
} from '@/lib/sessions'

// POST /api/community/mentoring/manage — a cohort's mentor configures it
// (PRD §11): assign training material, and schedule a session series.
// Body: { cohortId, action, ...payload }. Mentor-gated by isCohortMentor.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  if (!b.cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 })
  if (!(await isCohortMentor(b.cohortId, member.id))) {
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
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
