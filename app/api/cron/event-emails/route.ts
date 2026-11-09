import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { partitionByTenant, runPerTenant, type TenantJob } from '@/lib/cron-tenants'
import { getEventBySlug } from '@/lib/events/repo'
import { sendEventEmail, reclaimStuckSending } from '@/lib/event-emails/send'
import { scheduleDecision } from '@/lib/event-emails/schedule'
import { todayInMountain, todayInZone } from '@/lib/event-emails/render'
import { runCatchUps } from '@/lib/event-emails/catch-up'
import { isTenantRow, loadTenantSender, tenantEventMailEnabled } from '@/lib/event-emails/tenant-mail'
import { drainOutbox } from '@/lib/esign/outbox'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

export const maxDuration = 60

// GET /api/cron/event-emails — sends scheduled event emails that are due.
// Vercel cron, three daily slots (vercel.json): 15:00, 17:00 and 19:00 UTC,
// i.e. ~9am, 11am and 1pm Mountain. One big send takes most of a 60s function
// (Resend allows ~2 emails/second), and Hobby crons run at most daily, so each
// slot sends what fits and leaves the rest for the next slot.
//
// After the scheduled sends, each slot also catches up late registrants on
// emails already sent to All participants (lib/event-emails/catch-up.ts).
//
// Per tenant (S5 B14): the scheduled sends, the re-drive of stale sends and the
// catch-ups run once per tenant through runPerTenant (lib/cron-tenants.ts),
// Stellr first. Stellr alone is the runner's plain call: the same rows, order,
// time budget, mail and result as before, with failures under the same labels.
// Another tenant's mail goes out only with TENANT_EVENT_MAIL_ENABLED, from its
// own sender, on its own clock; with the flag off its scheduled rows are held
// and counted in `tenantHeld`. Every tenant's mail counts on the one shared daily
// email counter (owner decision, 9 Nov 2026).

/** Don't start another email once this much of the budget is gone. */
const START_BUDGET_MS = 15_000

/**
 * How long past its slice the runner waits for a tenant before moving on. One
 * send can take ~41 s (75 recipients at Resend's ~2 a second), and moving on
 * mid-send would run two tenants' sends at once against one account's rate. So
 * the runner waits out a send that started inside its slice, as a single run
 * always has, and the next tenant starts only when it is done or the run's own
 * start budget has gone.
 */
const SEND_OVERRUN_MS = 45_000

type Counts = {
  due: number
  sent: number
  skipped: number
  deferred: number
  resumed: number
  catchUpEmailed: number
  catchUpDeferred: number
}

const emptyCounts = (): Counts => ({ due: 0, sent: 0, skipped: 0, deferred: 0, resumed: 0, catchUpEmailed: 0, catchUpDeferred: 0 })

export const GET = withCronAudit('event-emails', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const started = Date.now()
  const db = supabaseServer()
  const run = await startCronRun(db, 'event-emails')
  const today = todayInMountain()

  const { data: rows, error } = await db
    .from('event_emails')
    .select('id, event_slug, schedule_days_before, tenant_id')
    .eq('status', 'scheduled')
    .not('schedule_days_before', 'is', null)
    .order('created_at', { ascending: true })
  if (error) {
    run.fail('query', error.message)
    await run.finish({ sent: 0 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const byTenant = partitionByTenant((rows ?? []) as { id: string; event_slug: string; schedule_days_before: number; tenant_id: string | null }[])
  const tenantMail = tenantEventMailEnabled()
  // Stellr always has a turn: its re-drives and catch-ups run whether or not it
  // has a scheduled email due.
  const tenantIds = new Set<string>([STELLR_TENANT_ID])
  let tenantHeld = 0
  for (const [id, group] of byTenant) {
    if (id === STELLR_TENANT_ID) continue
    if (tenantMail) tenantIds.add(id)
    else tenantHeld += group.length
  }
  if (tenantMail) {
    // Tenants with no scheduled email can still have a stale send or a catch-up.
    // Only read with the flag on, so a Stellr-only run makes no extra query
    // (runPerTenant skips its tenants read when Stellr is the only tenant).
    const { data: others, error: othersError } = await db
      .from('event_emails')
      .select('tenant_id')
      .in('status', ['sending', 'sent'])
      .not('tenant_id', 'is', null)
      .neq('tenant_id', STELLR_TENANT_ID)
    if (othersError) run.fail('tenant-follow-ups', othersError.message)
    for (const r of others ?? []) if (isTenantRow(r.tenant_id as string | null)) tenantIds.add(r.tenant_id as string)
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
    due: 0, sent: 0, skipped: 0, deferred: 0, resumed: 0, catchUpEmailed: 0, catchUpDeferred: 0,
    signingEmailsSent: 0, signingEmailsWaiting: 0,
  }

  const runTenant = async (job: TenantJob): Promise<Counts> => {
    const tenantId = job.tenant.id
    const mine = emptyCounts()
    const add = (key: keyof Counts, n = 1) => {
      mine[key] += n
      result[key] += n
    }
    const stellr = tenantId === STELLR_TENANT_ID
    const sender = stellr ? undefined : await loadTenantSender(db, tenantId)
    if (!stellr && !sender) {
      // No sender, no mail: the tenant's rows stay where they are for a later run.
      job.fail('sender', new Error('tenant has no usable sender'))
      return mine
    }
    const day = stellr ? today : todayInZone(job.tenant.timeZone)
    // For Stellr alone job.deadline is started + START_BUDGET_MS, so this is the
    // same test as before; with other tenants it is this tenant's own slice.
    const budgetLeft = () => !job.signal.aborted && Date.now() <= job.deadline
    // A tenant's sends also stop between recipients once the runner aborts its
    // slice, so they never keep sending alongside the next tenant or the outbox
    // drain below. Stellr's sends carry neither, so they run as they always have.
    const withSender = sender ? { sender, signal: job.signal } : {}

    for (const row of byTenant.get(tenantId) ?? []) {
      const slug = row.event_slug
      const decision = scheduleDecision(await eventDate(slug), row.schedule_days_before, day)
      if (decision === 'wait') continue
      if (decision === 'skip') {
        await db.from('event_emails').update({ status: 'skipped' }).eq('id', row.id).eq('status', 'scheduled')
        add('skipped')
        continue
      }

      add('due')
      if (!budgetLeft()) {
        add('deferred')
        continue
      }
      const out = await sendEventEmail(db, row.id, { trigger: 'schedule', triggeredBy: 'schedule', ...withSender })
      if (out.ok) add('sent')
      else job.fail(row.id, out.error)
    }

    // deep review INT-1: pick up any send abandoned in 'sending' by a killed
    // function and finish it (skipping whoever the killed run already emailed),
    // before the catch-up pass re-checks who is owed.
    const resumed = await reclaimStuckSending(db, budgetLeft, { tenantId, ...withSender })
    add('resumed', resumed.reclaimed)
    for (const e of resumed.errors) job.fail(`resume:${e.id}`, e.error)

    const catchUps = await runCatchUps(db, eventDate, budgetLeft, day, { tenantId, ...withSender })
    add('catchUpEmailed', catchUps.emailed)
    add('catchUpDeferred', catchUps.deferred)
    for (const e of catchUps.errors) job.fail(`catch-up:${e.id}`, e.error)
    return mine
  }

  // Stellr alone: a throw ends the run as it always has, with no run.finish and
  // the route's 500, rather than becoming a recorded tenant failure.
  const stellrOnly = tenantIds.size === 1
  const stellrFailure: unknown[] = []
  const outcome = await runPerTenant<Counts>(db, run, {
    job: 'event-emails',
    deadline: started + START_BUDGET_MS,
    tenantIds: [...tenantIds],
    overrunMs: SEND_OVERRUN_MS,
    fn: async (job) => {
      try {
        return await runTenant(job)
      } catch (err) {
        if (!stellrOnly) throw err
        stellrFailure.push(err)
        return emptyCounts()
      }
    },
  })
  if (stellrFailure.length) throw stellrFailure[0]

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

  // tenantHeld and the ledger are absent from a Stellr-only run's result.
  await run.finish({ ...result, ...(tenantHeld ? { tenantHeld } : {}), ...outcome.ledger })
  return NextResponse.json(result)
})
