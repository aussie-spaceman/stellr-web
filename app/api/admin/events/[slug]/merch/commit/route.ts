import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { commitEventBatch, getEventBatchSummary, type ShipTo } from '@/lib/store/event-batch'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

// GET  — how many items await a batch + current batch status.
// POST — commit one bulk Printful order to the venue (body: ship_to address).
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const summary = await getEventBatchSummary(supabaseServer(), slug)
  return NextResponse.json(summary)
}

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const shipTo = body?.shipTo as ShipTo | undefined
  if (!shipTo?.name || !shipTo?.line1 || !shipTo?.city || !shipTo?.state || !shipTo?.postcode) {
    return NextResponse.json({ error: 'Complete ship-to address required (name, line1, city, state, postcode)' }, { status: 400 })
  }

  // Resolve committer's member id (best-effort).
  const db = supabaseServer()
  let committedBy: string | null = null
  const { userId } = await auth()
  if (userId) {
    const { data: m } = await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
    committedBy = (m as { id?: string } | null)?.id ?? null
  }

  try {
    const result = await commitEventBatch(db, slug, shipTo, committedBy)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
