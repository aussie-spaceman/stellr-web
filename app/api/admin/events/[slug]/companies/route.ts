import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { autoAssign, AssignError } from '@/lib/team-profile/assign'
import { loadSurveyEvent } from '@/lib/survey/events'

// Company management for an event (admins + assigned event managers).
//   GET  — list companies with participant counts
//   PUT  — { count } set number of companies (1-10); trims/creates rows
//   POST — { action: 'auto_assign' }  (lib/team-profile/assign.ts: students
//          with a submitted team profile; hand-placed students stay put)
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
      // A hand placement sticks: Auto-Assign leaves it alone. Moving a student
      // back to unassigned releases them.
      .update({ company_id: companyId, company_locked: companyId !== null })
      .eq('id', participantId)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'auto_assign') {
    const event = await loadSurveyEvent(slug)
    try {
      const result = await autoAssign(db, slug, event?.date ?? null)
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof AssignError) return NextResponse.json({ error: err.message }, { status: 400 })
      console.error('[companies] auto-assign failed:', err)
      return NextResponse.json({ error: 'Database error during assignment' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
