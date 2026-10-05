import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { runSurveys } from '@/lib/survey/run'

export const maxDuration = 60

// GET /api/cron/surveys — the post-event survey's clock (lib/survey/run.ts):
// schedules a survey for every upcoming event, opens surveys at 00:00
// event-local on the event's last day, closes them 30 days later, invites
// everyone (late participants included) and sends reminders, all within the
// daily survey email budget.
//
// Vercel Hobby runs each cron at most once a day, so three slots (vercel.json):
// 07:00 UTC (US local midnight has passed everywhere but Alaska and Hawaii),
// 16:00 and 22:00 UTC. A survey therefore opens within ~3 hours of its go-live
// time; "Send live now" in the admin tab opens one immediately.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'surveys')
  try {
    const result = await runSurveys(db, { budgetMs: 45_000 })
    for (const e of result.errors) run.fail(e.where, e.message)
    await run.finish({
      created: result.events.created,
      rescheduled: result.events.rescheduled,
      flagged: result.events.flagged,
      opened: result.opened,
      closed: result.closed,
      invited: result.tally.invited,
      reminded: result.tally.reminded,
      deferred: result.tally.deferred,
      failed: result.tally.failed,
      quotaHit: result.tally.quotaHit,
      distributions: result.distributions,
    })
    return NextResponse.json(result)
  } catch (err) {
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
