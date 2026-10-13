import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { isRealProductionApp } from '@/lib/env-guards'
import { syncEventOptions } from '@/lib/hubspot-event-options'

// GET /api/cron/hubspot-event-options — runs daily (see vercel.json).
//
// Keeps HubSpot's Event Location / Year / Theme / Demographic option lists, on
// contacts and deals, matching the live events in Sanity
// (lib/hubspot-event-options.ts). The Sanity publish webhook does the same on
// every edit; this is the safety net for anything it missed — a webhook that
// didn't fire, an event deleted rather than edited — and it is what retires
// last school year's options on 1 August, which no edit triggers.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'hubspot-event-options')

  // One HubSpot portal, no sandbox: guardCron already limits this to
  // APP_ENV=prod; the second check keeps the dev project's production target
  // (VERCEL_ENV=production there too) from ever writing.
  const result = await syncEventOptions({ apply: isRealProductionApp() })

  const summary = {
    ok: result.ok,
    applied: result.applied,
    refused: result.refused,
    liveEvents: result.liveEvents.length,
    updated: result.properties
      .filter((p) => p.status === 'updated' || p.status === 'would-update')
      .map((p) => `${p.object}.${p.property}`),
    form: result.form.status,
    unmapped: result.unmapped,
  }

  if (result.refused) run.fail('sync', result.refused)
  for (const p of result.properties) {
    if (p.status === 'failed') run.fail(`${p.object}.${p.property}`, p.error ?? 'failed')
  }
  if (result.form.status === 'failed') run.fail('event-notify-form', result.form.error ?? 'failed')
  // An event the sync couldn't map contributes nothing to the dropdowns — worth
  // seeing in the ledger, since it means a Sanity field is blank or unreadable.
  for (const u of result.unmapped) run.fail('unmapped', u)

  if (summary.updated.length || !result.ok) {
    console.log('[cron:hubspot-event-options]', JSON.stringify({ ...summary, properties: result.properties }))
  }

  await run.finish(summary)
  return NextResponse.json(summary, { status: 200 })
}
