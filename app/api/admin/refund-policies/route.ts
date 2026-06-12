import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { memberIdForClerkUser } from '@/lib/deletion/actor'
import { DEFAULT_TIERS, type RefundTier } from '@/lib/refunds/policy'

// GET  /api/admin/refund-policies            → { global, event? }  (?event=slug)
// PUT  /api/admin/refund-policies            → upsert { scope, eventSlug?, tiers }
// DELETE /api/admin/refund-policies?event=   → remove a per-event override

export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const eventSlug = new URL(req.url).searchParams.get('event')
  const db = supabaseServer()

  const { data: globalRow } = await db.from('refund_policies').select('tiers').eq('scope', 'global').maybeSingle()
  const result: { global: RefundTier[]; event?: RefundTier[] | null } = {
    global: (globalRow?.tiers as RefundTier[]) ?? DEFAULT_TIERS,
  }
  if (eventSlug) {
    const { data: eventRow } = await db
      .from('refund_policies')
      .select('tiers')
      .eq('scope', 'event')
      .eq('event_slug', eventSlug)
      .maybeSingle()
    result.event = (eventRow?.tiers as RefundTier[]) ?? null
  }
  return NextResponse.json(result)
}

function validTiers(tiers: unknown): tiers is RefundTier[] {
  return (
    Array.isArray(tiers) &&
    tiers.length > 0 &&
    tiers.every(
      (t) =>
        t && typeof t.minDaysOut === 'number' &&
        (t.cashPct === null || typeof t.cashPct === 'number') &&
        (t.creditPct === null || typeof t.creditPct === 'number') &&
        (t.creditValidityDays === null || typeof t.creditValidityDays === 'number')
    )
  )
}

export async function PUT(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const scope = body?.scope === 'event' ? 'event' : 'global'
  const eventSlug = scope === 'event' ? (body?.eventSlug as string | undefined) : null
  const tiers = body?.tiers
  if (scope === 'event' && !eventSlug) return NextResponse.json({ error: 'eventSlug required' }, { status: 400 })
  if (!validTiers(tiers)) return NextResponse.json({ error: 'Invalid tiers' }, { status: 400 })

  const db = supabaseServer()
  const updatedBy = await memberIdForClerkUser(userId)

  // Upsert keyed by the unique constraints (scope='global' partial unique;
  // event_slug unique). Look up existing id first to update in place.
  const existing = await db
    .from('refund_policies')
    .select('id')
    .eq('scope', scope)
    .eq(scope === 'event' ? 'event_slug' : 'scope', scope === 'event' ? eventSlug! : 'global')
    .maybeSingle()

  if (existing.data?.id) {
    await db.from('refund_policies').update({ tiers, updated_by: updatedBy, updated_at: new Date().toISOString() }).eq('id', existing.data.id)
  } else {
    await db.from('refund_policies').insert({ scope, event_slug: eventSlug, tiers, updated_by: updatedBy })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const eventSlug = new URL(req.url).searchParams.get('event')
  if (!eventSlug) return NextResponse.json({ error: 'event required' }, { status: 400 })

  const db = supabaseServer()
  await db.from('refund_policies').delete().eq('scope', 'event').eq('event_slug', eventSlug)
  return NextResponse.json({ success: true })
}
