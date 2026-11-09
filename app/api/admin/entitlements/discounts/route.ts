import { NextResponse } from 'next/server'
import { isStellrAdmin } from '@/lib/authz'
import { listDiscounts, upsertDiscount, deleteDiscount, type DiscountInput } from '@/lib/entitlements'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

export async function GET() {
  if (!(await isStellrAdmin({ route: '/api/admin/entitlements/discounts' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const discounts = await listDiscounts()
    return NextResponse.json({ discounts })
  } catch (err) {
    console.error('[admin/entitlements/discounts] list:', err)
    return NextResponse.json({ error: 'Could not load discounts' }, { status: 500 })
  }
}

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'entitlement.discount.save',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'discounts', id: auditedId.get(req) ?? null },
  }),
  saveDiscount,
)

// Create or update a tier discount / coupon.
async function saveDiscount(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/entitlements/discounts' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as (DiscountInput & { id?: string }) | null
  if (!body || (body.kind !== 'tier' && body.kind !== 'coupon')) {
    return NextResponse.json({ error: "kind must be 'tier' or 'coupon'" }, { status: 400 })
  }
  try {
    const discount = await upsertDiscount(body)
    auditedId.set(req, discount.id)
    return NextResponse.json({ discount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save discount'
    console.error('[admin/entitlements/discounts] upsert:', err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export const DELETE = withAudit(
  ({ args: [req] }) => ({
    action: 'entitlement.discount.delete',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'discounts', id: auditedId.get(req) ?? null },
  }),
  removeDiscount,
)

async function removeDiscount(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/entitlements/discounts' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  auditedId.set(req, id)
  try {
    await deleteDiscount(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/entitlements/discounts] delete:', err)
    return NextResponse.json({ error: 'Could not delete discount' }, { status: 500 })
  }
}
