import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { archiveProduct, getProduct, updateProduct } from '@/lib/store/products'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    const product = await getProduct(id)
    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ product })
  } catch (err) {
    console.error('[store/products/:id] get:', err)
    return NextResponse.json({ error: 'Could not load product' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    await updateProduct(id, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/products/:id] patch:', err)
    return NextResponse.json({ error: 'Could not update product' }, { status: 500 })
  }
}

// Soft delete = archive (retain, hide). Hard purge runs through lib/deletion.
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    await archiveProduct(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/products/:id] archive:', err)
    return NextResponse.json({ error: 'Could not archive product' }, { status: 500 })
  }
}
