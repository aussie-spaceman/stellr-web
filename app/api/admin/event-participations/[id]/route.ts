import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentTenantId, requireTenantCrew } from '@/lib/authz'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import { enforcedTenantFilter, loadRecord, scopedRowWrite } from '@/lib/tenancy/load-scoped'
import { isStellrScope, tenantWideScope, type ScopeContext } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/event-participations/[id]'

type Args = [Request, { params: Promise<{ id: string }> }]
type Row = { member_id?: string | null; event_year?: number | null; event_location?: string | null; team_name?: string | null; award?: string | null }

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null; tenantId: string; status?: unknown }>()

function eventFor(req: Request) {
  const a = audited.get(req)
  return {
    actor: a ? { userId: a.userId } : { session: true as const },
    tenant: { tenantId: a?.tenantId ?? null },
    target: { table: 'event_participations', id: a?.id ?? null },
    metadata: typeof a?.status === 'string' ? { newStatus: a.status } : null,
  }
}

const notFound = () => NextResponse.json({ error: 'Event record not found' }, { status: 404 })

// Enforced, a row outside the scope is simply not found. Otherwise the write below decides,
// as it always has: a second tab deleting a row already gone is told it worked, and a
// pre-read that fails does not stop an admin removing a record.
const stopsAtLoad = (scope: ScopeContext) => enforcedTenantFilter(scope, 'event_participations') !== null

// PATCH /api/admin/event-participations/[id] — admin edits and/or approves a record
export const PATCH = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'event_participation.record.update', ...eventFor(req) }), updateParticipation)

async function updateParticipation(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireTenantCrew(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const { id } = await params
  const body = await req.json()
  const { event_year, event_location, team_name, award, status } = body
  audited.set(req, { id, userId, tenantId: admin.tenantId, status })

  const update: Record<string, unknown> = {}
  if (event_year !== undefined) update.event_year = event_year || null
  if (event_location !== undefined) update.event_location = event_location || null
  if (team_name !== undefined) update.team_name = team_name || null
  if (award !== undefined) update.award = award || null
  if (status !== undefined) update.status = status

  const db = supabaseServer()
  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')
  const loaded = await loadRecord<{ id: string }>(scope, 'event_participations', id, { db, select: 'id', notFound, label: ROUTE })
  if (!loaded.ok && stopsAtLoad(scope)) return loaded.response

  const { data, error } = await scopedRowWrite(scope, 'event_participations', id, { db }).update(update).select().single()

  if (error) {
    console.error('Admin event participation update error:', error)
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
  }

  // Audit trail — recorded against the participating member when one is linked. That log
  // is global, and a tenant's records stay off it (owner decision B8).
  const row = data as Row
  if (row.member_id && isStellrScope(scope)) {
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
export const DELETE = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'event_participation.record.delete', ...eventFor(req) }), deleteParticipation)

async function deleteParticipation(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireTenantCrew(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const { id } = await params
  audited.set(req, { id, userId, tenantId: admin.tenantId })
  const db = supabaseServer()
  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')

  const loaded = await loadRecord<Row>(scope, 'event_participations', id, {
    db,
    select: 'member_id, event_year, event_location, team_name',
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok && stopsAtLoad(scope)) return loaded.response

  const { error } = await scopedRowWrite(scope, 'event_participations', id, { db }).delete()

  if (error) {
    console.error('Admin event participation delete error:', error)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }

  const row = loaded.ok ? loaded.row : null
  if (row?.member_id && isStellrScope(scope)) {
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
