import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { lastCronResult, startCronRun } from '@/lib/cron-runs'
import { sendEmail, staffAlertEmail } from '@/lib/email'
import { fetchEngagedProspects, reconcileProspects } from '@/lib/apollo-reconcile'

// GET /api/cron/apollo-reconcile — runs daily (see vercel.json).
//
// The safety net under the Apollo webhook.
//
// Why this exists
// ---------------
// The webhook is fire-and-forget. Apollo posts once; if that delivery never
// arrives, or arrives in a shape we cannot use, the engagement is gone and
// nothing anywhere says so — Apollo shows a workflow step, HubSpot shows
// nothing, and no one finds out until someone happens to notice a reply in
// their inbox that never became a deal.
//
// That is exactly what happened. Apollo's "Send webhook" action was saved with
// an **empty request body**, so every delivery arrived as an unparseable POST
// and was rejected with a 400. The integration looked healthy from both ends
// and silently dropped every event for five days.
//
// So correctness no longer depends on the webhook being perfect. This asks
// Apollo what has engaged, asks HubSpot what already has a deal, and closes the
// difference. The webhook remains the fast path — this is what makes it safe.
//
// It is idempotent by construction: `decideDealAction` treats an existing open
// deal as a no-op, so on a healthy day this runs, finds nothing, and writes
// nothing.
//
// Anything it *does* have to fix is, by definition, something the webhook
// missed — which makes a non-zero result the alert that the webhook is broken.

export const dynamic = 'force-dynamic'

// deep review INT-8: each prospect costs several sequential HubSpot round-trips
// and the Apollo fetch now backs off on a 429, so give the run room rather than
// letting the default budget kill it mid-reconcile.
export const maxDuration = 60

/**
 * Bounded so a runaway Apollo response cannot rewrite the pipeline, and because
 * each prospect costs several HubSpot round-trips — an unbounded run would
 * exhaust the rate limit and outlive the function.
 *
 * The window ROTATES (see below). It used to take the same first 200 every run,
 * so past 200 engaged contacts anyone beyond that index was never reconciled,
 * silently. At 48 contacts that was latent; it would not have announced itself.
 */
const MAX_PER_RUN = 200

/**
 * Stop starting prospects 40 s in, leaving 20 s of the 60 s for the one in
 * flight (its HubSpot retries can take several seconds), the alert email and
 * closing the cron_runs row. Without it, 110 prospects at ~1.3 s each ran past
 * 60 s every day from 13 to 21 Oct 2026: Vercel killed the function, so no run
 * was ever recorded as finished, no alert went out, and the same first ~45
 * prospects were re-checked daily while the rest were never reached.
 */
const RUN_BUDGET_MS = 40_000

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked
  const startedAt = Date.now()

  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) {
    console.error('[apollo-reconcile] APOLLO_API_KEY is not set — cannot reconcile')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // deep review INT-9: record every run in cron_runs so a broken Apollo/HubSpot
  // integration is visible in the DB after Vercel's 1h log retention expires.
  const db = supabaseServer()
  // Resume where the last finished run stopped (its result.nextOffset). The
  // cursor lives in the cron_runs ledger, so it needs no state of its own; a
  // run that is killed or fails before finishing leaves the cursor where it was.
  const previous = await lastCronResult(db, 'apollo-reconcile')
  const resumeAt = typeof previous?.nextOffset === 'number' ? previous.nextOffset : 0
  const run = await startCronRun(db, 'apollo-reconcile')

  try {
    const prospects = await fetchEngagedProspects(apiKey)

    const result = await reconcileProspects(prospects, {
      apply: true,
      limit: MAX_PER_RUN,
      offset: resumeAt,
      deadline: startedAt + RUN_BUDGET_MS,
      onLog: (line) => console.log('[apollo-reconcile]', line),
    })

    const repaired = result.created + result.advanced

    // Truncation is itself worth an alert. It means the reconciler can no longer
    // see everyone in a single run, so a webhook gap can now sit unrepaired for
    // up to `daysToCover` days — a change in behaviour nobody would otherwise
    // notice, which is exactly how the original bug stayed invisible. A run cut
    // short by the time budget is the same situation, but it is the normal case
    // at today's size, so it is recorded (cron_runs) and named in any alert that
    // goes out anyway, rather than mailed every day on its own.
    const perRun = Math.max(result.considered, 1)
    const daysToCover = Math.ceil(result.total / perRun)

    if (repaired > 0 || result.failed > 0 || result.truncated) {
      // A gap means the webhook did not do its job. Say so plainly, and name
      // the records, because the whole point is that this stops being silent.
      const rows = result.changes.map(
        (c) =>
          `${c.email} — ${c.action} (${c.engagement})${c.dealId ? ` deal ${c.dealId}` : ''}`,
      )
      const preamble =
        `The daily Apollo reconciliation had to create or advance ${repaired} deal(s). ` +
        `Anything listed here is engagement the webhook failed to deliver — check the ` +
        `two Apollo workflows (Workflows → Send webhook, and confirm the request Body ` +
        `is not empty) before this becomes a habit.`
      const tail =
        (result.failed ? `${result.failed} record(s) FAILED to write. ` : '') +
        `Considered ${result.considered} of ${result.total} engaged contacts ` +
        `(window from index ${result.windowOffset}); ${result.skipped} already had a deal.` +
        (result.truncated
          ? ` NOTE: there are now more than ${MAX_PER_RUN} engaged contacts, so each ` +
            `run sees only part of them and the window rotates — full coverage takes ` +
            `${daysToCover} days. Raise MAX_PER_RUN or paginate if that is too slow.`
          : result.stoppedEarly
            ? ` This run reached its time limit, so the next one resumes at index ` +
              `${result.nextOffset}; at this pace full coverage takes about ${daysToCover} days.`
            : '')

      await sendEmail({
        // deep review INT-8: staffAlertEmail() always resolves to a real
        // address (CONTACT_EMAIL → hello@). The old `CONTACT_EMAIL ?? ''` sent
        // the alert to nowhere when the env was unset — the alert silently lost.
        to: staffAlertEmail(),
        subject: `Apollo reconciliation repaired ${repaired} deal(s)`,
        text: `${preamble}\n\n${rows.map((r) => `  • ${r}`).join('\n')}\n\n${tail}`,
        html:
          `<p>${preamble}</p><ul>${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` +
          `<p>${tail}</p>`,
      })
    }

    console.log(
      `[apollo-reconcile] considered=${result.considered}/${result.total} ` +
        `offset=${result.windowOffset} next=${result.nextOffset} ` +
        `truncated=${result.truncated} stoppedEarly=${result.stoppedEarly} ` +
        `created=${result.created} advanced=${result.advanced} ` +
        `skipped=${result.skipped} failed=${result.failed}`,
    )
    if (result.failed > 0) run.fail('reconcile', `${result.failed} record(s) failed to write`)
    await run.finish({ ...result })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    // deep review INT-8/INT-9: a thrown run (e.g. Apollo rate-limited after the
    // bounded retries) now surfaces as a recorded failure + 500, not a silent
    // hang that Vercel kills.
    console.error('[apollo-reconcile] Run failed', err)
    run.fail('run', err)
    // Carry the cursor forward, or the next run would read {} and restart at 0.
    await run.finish({ nextOffset: resumeAt })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
