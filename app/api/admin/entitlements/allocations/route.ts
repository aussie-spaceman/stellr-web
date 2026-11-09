import { NextResponse } from 'next/server'
import { isStellrAdmin } from '@/lib/authz'
import { setTierAllocationQuantity } from '@/lib/entitlements'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

export const PATCH = withAudit(
  ({ args: [req] }) => ({
    action: 'entitlement.allocation.update',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'tier_benefits', id: auditedId.get(req) ?? null },
  }),
  updateAllocation,
)

// Update a tier's free-allocation quantity (e.g. free coaching sessions or
// free mentoring cohorts per period).
async function updateAllocation(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/entitlements/allocations' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { id?: string; quantity?: number } | null
  if (!body?.id || typeof body.quantity !== 'number') {
    return NextResponse.json({ error: 'id and quantity required' }, { status: 400 })
  }
  auditedId.set(req, body.id)
  try {
    await setTierAllocationQuantity(body.id, body.quantity)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/entitlements/allocations] patch:', err)
    return NextResponse.json({ error: 'Could not update allocation' }, { status: 500 })
  }
}
