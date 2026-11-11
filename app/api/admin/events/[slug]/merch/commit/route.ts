import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { memberIdForClerkUser } from '@/lib/events/admin-config'
import { commitEventBatch, getEventBatchSummary, type ShipTo } from '@/lib/store/event-batch'
import { refuseOutsideStellr, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

const ROUTE = '/api/admin/events/[slug]/merch/commit'

// GET  — how many items await a batch + current batch status.
// POST — commit one bulk Printful order to the venue (body: ship_to address).
// Stellr's store and Printful account, so a tenant's staff are refused, and a tenant's
// event is refused for everyone (refuseUnlessStellrEvent).
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const summary = await getEventBatchSummary(stellrOnlyDb(staff.scope, supabaseServer()), slug)
  return NextResponse.json(summary)
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'merch.batch.commit', ...auditSubject(req, 'merch_batches') }),
  commitBatch,
)

async function commitBatch(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = await req.json().catch(() => ({}))
  const shipTo = body?.shipTo as ShipTo | undefined
  if (!shipTo?.name || !shipTo?.line1 || !shipTo?.city || !shipTo?.state || !shipTo?.postcode) {
    return NextResponse.json({ error: 'Complete ship-to address required (name, line1, city, state, postcode)' }, { status: 400 })
  }

  // Resolve committer's member id (best-effort).
  const db = stellrOnlyDb(staff.scope, supabaseServer())
  let committedBy: string | null = null
  const { userId } = await auth()
  if (userId) committedBy = await memberIdForClerkUser(db, userId)

  try {
    const result = await commitEventBatch(db, slug, shipTo, committedBy)
    noteAuditSubject(req, { id: result.batchId, detail: { items: result.items } })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
