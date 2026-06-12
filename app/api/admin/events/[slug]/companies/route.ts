import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { assignCompanies, type AssignableStudent } from '@/lib/company-assign'

// Company management for an event (admins + assigned event managers).
//   GET  — list companies with participant counts
//   PUT  — { count } set number of companies (1-10); trims/creates rows
//   POST — { action: 'auto_assign' }
//          { action: 'rename', companyId, name }
//          { action: 'move', participantId, companyId | null }

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const { data, error } = await db
    .from('event_companies')
    .select('id, number, name, participants(count)')
    .eq('event_slug', slug)
    .order('number')
  if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
  return NextResponse.json({ companies: data ?? [] })
}

export async function PUT(req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const count = Number(body?.count)
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return NextResponse.json({ error: 'count must be an integer between 1 and 10' }, { status: 400 })
  }

  const db = supabaseServer()

  // Create any missing companies up to `count`
  const rows = Array.from({ length: count }, (_, i) => ({ event_slug: slug, number: i + 1 }))
  const { error: upsertError } = await db
    .from('event_companies')
    .upsert(rows, { onConflict: 'event_slug,number', ignoreDuplicates: true })
  if (upsertError) return NextResponse.json({ error: 'Database error' }, { status: 500 })

  // Remove companies above `count` (participants.company_id nulls via ON DELETE SET NULL)
  const { error: deleteError } = await db
    .from('event_companies')
    .delete()
    .eq('event_slug', slug)
    .gt('number', count)
  if (deleteError) return NextResponse.json({ error: 'Database error' }, { status: 500 })

  await db
    .from('event_settings')
    .upsert({ event_slug: slug, company_count: count }, { onConflict: 'event_slug' })

  return NextResponse.json({ ok: true })
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const action = body?.action
  const db = supabaseServer()

  if (action === 'rename') {
    const { companyId, name } = body ?? {}
    if (typeof companyId !== 'string') return NextResponse.json({ error: 'companyId required' }, { status: 400 })
    const { error } = await db
      .from('event_companies')
      .update({ name: typeof name === 'string' && name.trim() ? name.trim() : null })
      .eq('id', companyId)
      .eq('event_slug', slug)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'move') {
    const { participantId, companyId } = body ?? {}
    if (typeof participantId !== 'string') {
      return NextResponse.json({ error: 'participantId required' }, { status: 400 })
    }
    if (companyId !== null) {
      const { data: company } = await db
        .from('event_companies')
        .select('id')
        .eq('id', companyId)
        .eq('event_slug', slug)
        .maybeSingle()
      if (!company) return NextResponse.json({ error: 'Unknown company' }, { status: 400 })
    }
    const { error } = await db
      .from('participants')
      .update({ company_id: companyId })
      .eq('id', participantId)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'auto_assign') {
    const { data: companies, error: compError } = await db
      .from('event_companies')
      .select('id, number')
      .eq('event_slug', slug)
      .order('number')
    if (compError) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    if (!companies || companies.length === 0) {
      return NextResponse.json({ error: 'Set the number of companies first' }, { status: 400 })
    }

    // Students only — adults and mentors are not placed in Companies
    const { data: regs, error: regError } = await db
      .from('registrations')
      .select('id, type, participants(id, event_role, gender, date_of_birth, member_id)')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn')
    if (regError) return NextResponse.json({ error: 'Database error' }, { status: 500 })

    const students: AssignableStudent[] = []
    const memberIds: string[] = []
    for (const reg of regs ?? []) {
      for (const p of (reg.participants as Record<string, unknown>[]) ?? []) {
        // Student managers compete as students too, so they're assigned to a
        // company alongside school students.
        if (p.event_role !== 'school_student' && p.event_role !== 'school_student_manager') continue
        const dob = p.date_of_birth as string | null
        students.push({
          participantId: p.id as string,
          groupKey: reg.type === 'group' ? reg.id : null,
          gender: (p.gender as string | null) ?? null,
          age: dob ? (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000) : null,
          experience: 0,
        })
        if (p.member_id) memberIds.push(p.member_id as string)
      }
    }
    if (students.length === 0) {
      return NextResponse.json({ error: 'No students to assign' }, { status: 400 })
    }

    // Experience = prior event participations per member
    if (memberIds.length > 0) {
      const { data: history } = await db
        .from('event_participations')
        .select('member_id')
        .in('member_id', memberIds)
      const expByMember = new Map<string, number>()
      for (const h of history ?? []) {
        expByMember.set(h.member_id, (expByMember.get(h.member_id) ?? 0) + 1)
      }
      const memberByParticipant = new Map<string, string>()
      for (const reg of regs ?? []) {
        for (const p of (reg.participants as Record<string, unknown>[]) ?? []) {
          if (p.member_id) memberByParticipant.set(p.id as string, p.member_id as string)
        }
      }
      for (const s of students) {
        const memberId = memberByParticipant.get(s.participantId)
        if (memberId) s.experience = expByMember.get(memberId) ?? 0
      }
    }

    const assignment = assignCompanies(students, companies.length)
    const companyIdByNumber = new Map(companies.map((c) => [c.number, c.id]))

    for (const [participantId, number] of assignment) {
      const { error } = await db
        .from('participants')
        .update({ company_id: companyIdByNumber.get(number) })
        .eq('id', participantId)
      if (error) return NextResponse.json({ error: 'Database error during assignment' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, assigned: assignment.size })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
