import { NextRequest, NextResponse } from 'next/server'
import { guardCron } from '@/lib/cron'
import { sendEmail } from '@/lib/email'
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

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) {
    console.error('[apollo-reconcile] APOLLO_API_KEY is not set — cannot reconcile')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  try {
    const prospects = await fetchEngagedProspects(apiKey)

    // Advance the window one page per day, so ceil(total / MAX_PER_RUN) days
    // covers everyone. Derived from the date rather than stored, so it needs no
    // new state and a missed run costs one day of coverage, not the sequence.
    const dayIndex = Math.floor(Date.now() / 86_400_000)

    const result = await reconcileProspects(prospects, {
      apply: true,
      limit: MAX_PER_RUN,
      offset: dayIndex * MAX_PER_RUN,
      onLog: (line) => console.log('[apollo-reconcile]', line),
    })

    const repaired = result.created + result.advanced

    // Truncation is itself worth an alert. It means the reconciler can no longer
    // see everyone in a single run, so a webhook gap can now sit unrepaired for
    // up to `daysToCover` days — a change in behaviour nobody would otherwise
    // notice, which is exactly how the original bug stayed invisible.
    const daysToCover = Math.ceil(result.total / MAX_PER_RUN)

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
          : '')

      await sendEmail({
        to: process.env.CONTACT_EMAIL ?? '',
        subject: `Apollo reconciliation repaired ${repaired} deal(s)`,
        text: `${preamble}\n\n${rows.map((r) => `  • ${r}`).join('\n')}\n\n${tail}`,
        html:
          `<p>${preamble}</p><ul>${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` +
          `<p>${tail}</p>`,
      })
    }

    console.log(
      `[apollo-reconcile] considered=${result.considered}/${result.total} ` +
        `offset=${result.windowOffset} truncated=${result.truncated} ` +
        `created=${result.created} advanced=${result.advanced} ` +
        `skipped=${result.skipped} failed=${result.failed}`,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[apollo-reconcile] Run failed', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
