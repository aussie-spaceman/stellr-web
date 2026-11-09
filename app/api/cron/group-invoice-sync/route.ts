import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { syncDueGroupInvoices } from '@/lib/group-billing'
import { settleDueShares } from '@/lib/teacher-share'

// GET /api/cron/group-invoice-sync — runs daily (see vercel.json).
//
// After a roster change, the function that handled it waits out a quiet period
// and then updates the group's unpaid invoice. If that function is cut off, or
// Stripe refuses, the update stays due. This is the backstop that runs it.
//
// It also settles groups whose students share the teacher's cost, the day after
// their event (lib/teacher-share.ts): one daily job rather than a new cron.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = withCronAudit('group-invoice-sync', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const db = supabaseServer()
  const run = await startCronRun(db, 'group-invoice-sync')
  try {
    const tally = await syncDueGroupInvoices(db as never, stripe)
    let shares: Record<string, number> = {}
    try {
      shares = await settleDueShares(db as never, stripe)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      console.error('[cron:group-invoice-sync] share settlement failed:', detail)
      run.fail('share-settle', detail)
    }
    const all = { ...tally, ...Object.fromEntries(Object.entries(shares).map(([k, v]) => [`share_${k}`, v])) }
    await run.finish(all)
    return NextResponse.json(all)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[cron:group-invoice-sync] failed:', detail)
    run.fail('sync', detail)
    await run.finish({})
    return NextResponse.json({ error: detail }, { status: 500 })
  }
})
