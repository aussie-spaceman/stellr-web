import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

// PATCH /api/admin/event-participations/[id] — admin edits and/or approves a record
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { event_year, event_location, team_name, award, status } = body

  const update: Record<string, unknown> = {}
  if (event_year !== undefined) update.event_year = event_year || null
  if (event_location !== undefined) update.event_location = event_location || null
  if (team_name !== undefined) update.team_name = team_name || null
  if (award !== undefined) update.award = award || null
  if (status !== undefined) update.status = status

  const db = supabaseServer()

  const { data, error } = await db
    .from('event_participations')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Admin event participation update error:', error)
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
  }

  // Audit trail — recorded against the participating member when one is linked.
  const row = data as { member_id?: string | null; event_year?: number | null; event_location?: string | null; team_name?: string | null; award?: string | null }
  if (row.member_id) {
    const ctx = [row.team_name, row.event_location, row.event_year].filter(Boolean).join(', ')
    const actor = await actorFromAuth()
    await logActivity({
      memberId: row.member_id,
      category: 'event',
      action: status !== undefined ? `event_participation_${status}` : 'event_participation_updated',
      summary: status !== undefined
        ? `Event participation marked ${status}${ctx ? ` — ${ctx}` : ''}`
        : `Event record updated${ctx ? ` — ${ctx}` : ''}`,
      metadata: { participationId: id, ...update },
      ...actor,
    })
  }

  return NextResponse.json({ participation: data })
}

// DELETE /api/admin/event-participations/[id] — admin deletes any event record
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { data: existing } = await db
    .from('event_participations')
    .select('member_id, event_year, event_location, team_name')
    .eq('id', id)
    .maybeSingle()

  const { error } = await db
    .from('event_participations')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Admin event participation delete error:', error)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }

  const row = existing as { member_id?: string | null; event_year?: number | null; event_location?: string | null; team_name?: string | null } | null
  if (row?.member_id) {
    const ctx = [row.team_name, row.event_location, row.event_year].filter(Boolean).join(', ')
    const actor = await actorFromAuth()
    await logActivity({
      memberId: row.member_id,
      category: 'event',
      action: 'event_participation_deleted',
      summary: `Removed event participation${ctx ? ` — ${ctx}` : ''}`,
      metadata: { participationId: id },
      ...actor,
    })
  }

  return NextResponse.json({ success: true })
}
