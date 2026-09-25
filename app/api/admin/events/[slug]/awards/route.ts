import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import {
  assignmentConflict,
  isAssignedAwardType,
  isSpecialist,
  type AssignedAwardType,
  type Assignment,
} from '@/lib/event-awards'
import {
  fullName,
  listAssignments,
  listEventCompanies,
  listEventStudents,
  type AssignmentRow,
} from '@/lib/event-certificates'
import { pendingAwardChanges } from '@/lib/event-award-issue'

export const dynamic = 'force-dynamic'

// Judging results for an event, as a draft. Nothing here reaches a student
// until ./issue turns the assignments into credentials.
// Rules (lib/event-awards.ts): champion = a whole company; each specialist
// award = one student per company; one specialist award per student.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  return NextResponse.json(await snapshot(supabaseServer(), slug))
}

async function snapshot(db: SupabaseClient, slug: string) {
  const [students, companies, assignments, pending, { data: settings }] = await Promise.all([
    listEventStudents(db, slug),
    listEventCompanies(db, slug),
    listAssignments(db, slug),
    pendingAwardChanges(db, slug),
    db.from('event_settings').select('awards_issued_at').eq('event_slug', slug).maybeSingle(),
  ])
  return {
    companies,
    students: students.map((s) => ({ id: s.id, name: fullName(s), companyId: s.company_id })),
    assignments: assignments.map(toAssignment),
    issuedAt: (settings?.awards_issued_at as string | null) ?? null,
    pending,
  }
}

function toAssignment(a: AssignmentRow): Assignment {
  return { awardType: a.award_type, participantId: a.participant_id, companyId: a.company_id }
}

type Body =
  | { action: 'set_champion'; companyId: string | null }
  | { action: 'add'; awardType: AssignedAwardType; participantId: string }
  | { action: 'remove'; awardType: AssignedAwardType; participantId: string }
  | { action: 'set_specialist'; awardType: AssignedAwardType; companyId: string | null; participantId: string | null }

// PUT — one change at a time; returns the new snapshot.
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as Partial<Body> & Record<string, unknown>
  const db = supabaseServer()
  const students = await listEventStudents(db, slug)
  const byId = new Map(students.map((s) => [s.id, s]))
  const assignments = (await listAssignments(db, slug)).map(toAssignment)
  const table = () => db.from('event_award_assignments')
  const row = (awardType: AssignedAwardType, participantId: string) => ({
    event_slug: slug,
    award_type: awardType,
    participant_id: participantId,
    company_id: byId.get(participantId)?.company_id ?? null,
    assigned_by: access.userId,
  })
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

  switch (body.action) {
    case 'set_champion': {
      const companyId = typeof body.companyId === 'string' ? body.companyId : null
      const members = companyId ? students.filter((s) => s.company_id === companyId) : []
      if (companyId && members.length === 0) return fail('That company has no students.')
      const { error: delError } = await table().delete().eq('event_slug', slug).eq('award_type', 'overall_champion')
      if (delError) return fail(delError.message, 500)
      if (members.length) {
        const { error } = await table().insert(members.map((m) => row('overall_champion', m.id)))
        if (error) return fail(error.message, 500)
      }
      break
    }

    case 'add': {
      if (!isAssignedAwardType(body.awardType) || typeof body.participantId !== 'string') return fail('awardType and participantId are required')
      if (!byId.has(body.participantId)) return fail('Not a student at this event.', 404)
      if (isSpecialist(body.awardType)) return fail('Use set_specialist for specialist awards.')
      const { error } = await table().upsert(row(body.awardType, body.participantId), {
        onConflict: 'event_slug,participant_id,award_type',
        ignoreDuplicates: true,
      })
      if (error) return fail(error.message, 500)
      break
    }

    case 'remove': {
      if (!isAssignedAwardType(body.awardType) || typeof body.participantId !== 'string') return fail('awardType and participantId are required')
      const { error } = await table()
        .delete()
        .eq('event_slug', slug)
        .eq('award_type', body.awardType)
        .eq('participant_id', body.participantId)
      if (error) return fail(error.message, 500)
      break
    }

    case 'set_specialist': {
      const awardType = body.awardType
      if (!isAssignedAwardType(awardType) || !isSpecialist(awardType)) return fail('A specialist awardType is required')
      const companyId = typeof body.companyId === 'string' ? body.companyId : null
      const participantId = typeof body.participantId === 'string' ? body.participantId : null
      if (participantId) {
        const student = byId.get(participantId)
        if (!student) return fail('Not a student at this event.', 404)
        if (student.company_id !== companyId) return fail('That student is not in this company.')
        const conflict = assignmentConflict(assignments, { awardType, participantId, companyId })
        if (conflict) return fail(conflict, 409)
        if (assignments.some((a) => a.awardType === awardType && a.participantId === participantId)) break
      }
      // One winner per company: clear the current one, then set the new one.
      let clear = table().delete().eq('event_slug', slug).eq('award_type', awardType)
      clear = companyId ? clear.eq('company_id', companyId) : clear.is('company_id', null)
      const { error: delError } = await clear
      if (delError) return fail(delError.message, 500)
      if (participantId) {
        const { error } = await table().insert(row(awardType, participantId))
        if (error) return fail(error.code === '23505' ? 'That student already holds a specialist award.' : error.message, error.code === '23505' ? 409 : 500)
      }
      break
    }

    default:
      return fail('Unknown action')
  }

  return NextResponse.json(await snapshot(db, slug))
}
