import { NextRequest, NextResponse } from 'next/server'
import { runEntitlementsLifecycle } from '@/lib/entitlements'

// GET /api/cron/entitlements — runs daily (see vercel.json).
// Re-grants per-period tier allowances (e.g. the quarterly free mentoring
// cohort) into the entitlements ledger, and expires granted lots whose
// membership has lapsed. Idempotent: a no-op until a new period opens or a
// membership lapses. Purchased entitlements are never touched.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runEntitlementsLifecycle()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/entitlements]:', err)
    return NextResponse.json({ error: 'lifecycle failed' }, { status: 500 })
  }
}
