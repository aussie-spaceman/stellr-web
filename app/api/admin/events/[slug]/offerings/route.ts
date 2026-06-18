import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

// Which store products/variants an event offers, and how: 'included' (free shirt,
// allocated per size at confirmation) or 'addon' (paid extra). Admin/Event-Manager
// gated via requireEventAccess.
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const [{ data: offs }, { data: products }] = await Promise.all([
    db
      .from('event_store_offerings')
      .select('id, treatment, variant:store_variants(id, sku, label, product:store_products(id, name))')
      .eq('event_slug', slug)
      .order('treatment'),
    db
      .from('store_products')
      .select('id, name, variants:store_variants(id, label, active)')
      .eq('status', 'active')
      .order('name'),
  ])

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

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const variantId = body?.variantId
  const treatment = body?.treatment
  if (!variantId || (treatment !== 'included' && treatment !== 'addon')) {
    return NextResponse.json({ error: 'variantId and treatment (included|addon) required' }, { status: 400 })
  }
  const db = supabaseServer()
  const { error } = await db.from('event_store_offerings').insert({ event_slug: slug, variant_id: variantId, treatment })
  if (error) {
    console.error('[event/offerings] add:', error)
    return NextResponse.json({ error: 'Could not add offering' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('event_store_offerings').delete().eq('id', id).eq('event_slug', slug)
  if (error) return NextResponse.json({ error: 'Could not remove offering' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
