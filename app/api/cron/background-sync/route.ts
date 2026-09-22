import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getBackgroundProvider } from '@/lib/background-provider'
import { syncStaleChecks } from '@/lib/background-sync'
import { guardCron } from '@/lib/cron'

// GET /api/cron/background-sync
// Vercel cron calls this daily (see vercel.json). Re-polls every open
// background check against the provider and applies any outcome whose webhook
// we missed. See lib/background-sync.ts for why this exists.
//
// Rows touched in the last hour are skipped so we never race a webhook that
// is about to land. guardCron means this only runs where APP_ENV=prod; on the
// dev deployment use the admin "Sync now" button instead.

const MIN_AGE_MINUTES = 60

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const provider = getBackgroundProvider()
  if (!provider.configured()) {
    return NextResponse.json({ skipped: true, reason: `${provider.name} not configured` })
  }

  const result = await syncStaleChecks(supabaseServer(), provider, { minAgeMinutes: MIN_AGE_MINUTES })
  console.log('[cron:background-sync]', JSON.stringify(result))
  return NextResponse.json(result)
}
