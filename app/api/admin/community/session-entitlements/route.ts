import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// Admin: configure how many coaching/mentoring sessions each tier includes
// (FR-COM-11/12). Kept as editable data while the entitlement model is finalised.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// POST — upsert a tier's session entitlement.
// Body: { tierId, sessionType, includedSessions, validityDays?, extraStripePriceId? }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.tierId || !['coaching', 'mentoring'].includes(b.sessionType)) {
    return NextResponse.json({ error: 'tierId and valid sessionType required' }, { status: 400 })
  }
  const db = supabaseServer()
  const { error } = await db.from('session_entitlements').upsert(
    {
      tier_id: b.tierId,
      session_type: b.sessionType,
      included_sessions: Number.isFinite(b.includedSessions) ? b.includedSessions : 0,
      validity_days: Number.isFinite(b.validityDays) ? b.validityDays : null,
      extra_stripe_price_id: b.extraStripePriceId || null,
    },
    { onConflict: 'tier_id,session_type' }
  )
  if (error) {
    console.error('[session-entitlements] upsert error:', error)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
