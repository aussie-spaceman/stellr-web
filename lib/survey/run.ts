/**
 * One pass of the survey machinery, shared by the cron, "Send live now" and
 * the Sanity webhook:
 *   1. make sure every upcoming event has a distribution, in step with its date
 *   2. open what is due, close what has expired
 *   3. for each open survey: invite anyone not yet invited (late participants,
 *      minors who have since signed V2.3), send queued invitations, then reminders
 * Idempotent; safe to run as often as wanted.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyClock, ensureDistribution, getDistribution, loadDefinition, materialiseInvitations, planFor, type DistributionRow } from './distributions'
import { loadAllSurveyEvents } from './events'
import { localDate } from './timezone'
import { emptyTally, sendQueued, sendReminders, type SendTally } from './send'

export interface RunResult {
  events: { created: number; rescheduled: number; flagged: number }
  opened: number
  closed: number
  distributions: { id: string; slug: string; newInvitations: number; awaitingConsent: number; unreachable: number }[]
  tally: SendTally
  errors: { where: string; message: string }[]
}

export async function sweepEvents(db: SupabaseClient, now: Date, result: RunResult): Promise<void> {
  const events = await loadAllSurveyEvents()
  for (const e of events) {
    // Past events matter only while their survey could still be open.
    if (!e.lastDay) continue
    const cutoff = localDate(new Date(now.getTime() - 32 * 86_400_000), e.timeZone)
    if (e.lastDay < cutoff) continue
    try {
      const r = await ensureDistribution(db, e, now)
      if (r.action === 'created') result.events.created++
      if (r.action === 'rescheduled') result.events.rescheduled++
      if (r.action === 'flagged') result.events.flagged++
    } catch (err) {
      result.errors.push({ where: `ensure:${e.slug}`, message: err instanceof Error ? err.message : String(err) })
    }
  }
}

/** Invite and send for one open distribution. */
export async function processDistribution(
  db: SupabaseClient,
  d: DistributionRow,
  tally: SendTally,
  deadline: number,
  now = new Date(),
): Promise<RunResult['distributions'][number]> {
  const { def } = await loadDefinition(db, d.definition_id)
  const plan = await planFor(db, d)
  const created = await materialiseInvitations(db, d, plan)
  const still = new Set(plan.invitable.map((p) => p.recipientKey))
  await sendQueued(db, d, def, still, tally, deadline, now)
  await sendReminders(db, d, def, still, tally, deadline, now)
  await db.from('survey_distributions').update({ last_run_at: now.toISOString() }).eq('id', d.id)
  return { id: d.id, slug: d.event_slug, newInvitations: created, awaitingConsent: plan.awaitingConsent.length, unreachable: plan.unreachable.length }
}

export async function runSurveys(
  db: SupabaseClient,
  opts: { now?: Date; budgetMs?: number; sweep?: boolean } = {},
): Promise<RunResult> {
  const now = opts.now ?? new Date()
  const deadline = Date.now() + (opts.budgetMs ?? 40_000)
  const result: RunResult = { events: { created: 0, rescheduled: 0, flagged: 0 }, opened: 0, closed: 0, distributions: [], tally: emptyTally(), errors: [] }

  if (opts.sweep !== false) {
    try {
      await sweepEvents(db, now, result)
    } catch (err) {
      result.errors.push({ where: 'sweep', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const clock = await applyClock(db, now)
  result.opened = clock.opened.length
  result.closed = clock.closed.length

  const { data: open, error } = await db.from('survey_distributions').select('*').eq('status', 'open').order('opens_at')
  if (error) throw new Error(`Reading open surveys failed: ${error.message}`)
  for (const d of (open ?? []) as DistributionRow[]) {
    if (Date.now() > deadline || result.tally.quotaHit) break
    try {
      result.distributions.push(await processDistribution(db, d, result.tally, deadline, now))
    } catch (err) {
      result.errors.push({ where: `distribution:${d.event_slug}`, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

/** "Send live now" and the like: process one distribution immediately. */
export async function runOne(db: SupabaseClient, distributionId: string): Promise<RunResult['distributions'][number] & { tally: SendTally }> {
  const d = await getDistribution(db, distributionId)
  if (!d || d.status !== 'open') throw new Error('Survey is not open')
  const tally = emptyTally()
  const r = await processDistribution(db, d, tally, Date.now() + 25_000)
  return { ...r, tally }
}
