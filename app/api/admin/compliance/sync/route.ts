import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { getBackgroundProvider } from '@/lib/background-provider'
import { syncStaleChecks } from '@/lib/background-sync'

// POST /api/admin/compliance/sync
// Admin-triggered version of the background-sync cron, with no age threshold:
// re-polls every open check right now. This is the recovery path when a
// webhook was missed, and the only path on the dev deployment (where the cron
// declines to run — see lib/cron.ts).
export async function POST() {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const provider = getBackgroundProvider()
  if (!provider.configured()) {
    return NextResponse.json(
      { error: `Background-check provider (${provider.name}) is not configured` },
      { status: 503 },
    )
  }

  const result = await syncStaleChecks(supabaseServer(), provider)
  return NextResponse.json({ ok: true, ...result })
}
