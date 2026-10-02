import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { getEventBySlug } from '@/lib/sanity'
import { sendEventEmail } from '@/lib/event-emails/send'
import { scheduleDecision } from '@/lib/event-emails/schedule'
import { todayInMountain } from '@/lib/event-emails/render'
import { runCatchUps } from '@/lib/event-emails/catch-up'
import { drainOutbox } from '@/lib/esign/outbox'

export const maxDuration = 60

// GET /api/cron/event-emails — sends scheduled event emails that are due.
// Vercel cron, three daily slots (vercel.json): 15:00, 17:00 and 19:00 UTC,
// i.e. ~9am, 11am and 1pm Mountain. One big send takes most of a 60s function
// (Resend allows ~2 emails/second), and Hobby crons run at most daily, so each
// slot sends what fits and leaves the rest for the next slot.
//
// After the scheduled sends, each slot also catches up late registrants on
// emails already sent to All participants (lib/event-emails/catch-up.ts).

/** Don't start another email once this much of the budget is gone. */
const START_BUDGET_MS = 15_000

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const started = Date.now()
  const db = supabaseServer()
  const run = await startCronRun(db, 'event-emails')
  const today = todayInMountain()

  const { data: rows, error } = await db
    .from('event_emails')
    .select('id, event_slug, schedule_days_before')
    .eq('status', 'scheduled')
    .not('schedule_days_before', 'is', null)
    .order('created_at', { ascending: true })
  if (error) {
    run.fail('query', error.message)
    await run.finish({ sent: 0 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const eventDates = new Map<string, string | null>()
  const eventDate = async (slug: string) => {
    if (!eventDates.has(slug)) {
      const e = (await getEventBySlug(slug).catch(() => null)) as { date?: string } | null
      eventDates.set(slug, e?.date ?? null)
    }
    return eventDates.get(slug) ?? null
  }
  const result = {
    due: 0, sent: 0, skipped: 0, deferred: 0, catchUpEmailed: 0, catchUpDeferred: 0,
    signingEmailsSent: 0, signingEmailsWaiting: 0,
  }
  for (const row of rows ?? []) {
    const slug = row.event_slug as string
    const decision = scheduleDecision(await eventDate(slug), row.schedule_days_before as number, today)
    if (decision === 'wait') continue
    if (decision === 'skip') {
      await db.from('event_emails').update({ status: 'skipped' }).eq('id', row.id).eq('status', 'scheduled')
      result.skipped++
      continue
    }

    result.due++
    if (Date.now() - started > START_BUDGET_MS) {
      result.deferred++
      continue
    }
    const out = await sendEventEmail(db, row.id as string, { trigger: 'schedule', triggeredBy: 'schedule' })
    if (out.ok) result.sent++
    else run.fail(row.id as string, out.error)
  }

  const catchUps = await runCatchUps(db, eventDate, () => Date.now() - started <= START_BUDGET_MS, today)
  result.catchUpEmailed = catchUps.emailed
  result.catchUpDeferred = catchUps.deferred
  for (const e of catchUps.errors) run.fail(`catch-up:${e.id}`, e.error)

  // Stellr signing emails waiting on the daily budget: three more chances a
  // day for a group's links to go out, while time allows.
  if (Date.now() - started <= START_BUDGET_MS * 2) {
    try {
      const outbox = await drainOutbox(db, { limit: 20 })
      result.signingEmailsSent = outbox.sent
      result.signingEmailsWaiting = outbox.waiting - outbox.sent
    } catch (err) {
      run.fail('esign-outbox', err)
    }
  }

  await run.finish(result)
  return NextResponse.json(result)
}
