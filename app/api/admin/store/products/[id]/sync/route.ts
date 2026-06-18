import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { syncFromPrintful } from '@/lib/store/products'
import { printfulEnabled } from '@/lib/store/printful'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Import a Printful sync product's variants into this product's variant list.
export async function POST(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!printfulEnabled()) return NextResponse.json({ error: 'Printful not configured' }, { status: 503 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const printfulSyncProductId = Number(body?.printfulSyncProductId)
  if (!printfulSyncProductId) {
    return NextResponse.json({ error: 'printfulSyncProductId required' }, { status: 400 })
  }
  try {
    const result = await syncFromPrintful(id, printfulSyncProductId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[store/sync]:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
