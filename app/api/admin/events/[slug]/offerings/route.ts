import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { addEventOffering, loadEventOfferings, removeEventOffering } from '@/lib/events/admin-config'
import { refuseOutsideStellr, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

const ROUTE = '/api/admin/events/[slug]/offerings'

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

// Which store products/variants an event offers, and how: 'included' (free shirt,
// allocated per size at confirmation) or 'addon' (paid extra). Admins and the
// event's managers. The products are Stellr's store, so a tenant's staff are refused,
// and a tenant's event is refused for everyone (refuseUnlessStellrEvent).
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const { offs, products } = await loadEventOfferings(stellrOnlyDb(staff.scope, supabaseServer()), slug)

  const offerings = (offs ?? []).map((o) => {
    const v = arr((o as { variant?: unknown }).variant) as { id: string; sku: string; label: string | null; product?: unknown } | undefined
    const prod = arr(v?.product) as { id: string; name: string } | undefined
    return {
      id: (o as { id: string }).id,
      treatment: (o as { treatment: string }).treatment,
      variantId: v?.id ?? null,
      sku: v?.sku ?? null,
      label: v?.label ?? null,
      productName: prod?.name ?? null,
    }
  })

  return NextResponse.json({ offerings, products: products ?? [] })
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_offering.record.create', ...auditSubject(req, 'event_store_offerings') }),
  addOffering,
)

async function addOffering(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = await req.json().catch(() => ({}))
  const variantId = body?.variantId
  const treatment = body?.treatment
  if (!variantId || (treatment !== 'included' && treatment !== 'addon')) {
    return NextResponse.json({ error: 'variantId and treatment (included|addon) required' }, { status: 400 })
  }
  noteAuditSubject(req, { detail: { treatment } })
  const { error } = await addEventOffering(stellrOnlyDb(staff.scope, supabaseServer()), slug, variantId, treatment)
  if (error) {
    console.error('[event/offerings] add:', error)
    return NextResponse.json({ error: 'Could not add offering' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_offering.record.delete', ...auditSubject(req, 'event_store_offerings') }),
  removeOffering,
)

async function removeOffering(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  noteAuditSubject(req, { id })
  const { error } = await removeEventOffering(stellrOnlyDb(staff.scope, supabaseServer()), slug, id)
  if (error) return NextResponse.json({ error: 'Could not remove offering' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
