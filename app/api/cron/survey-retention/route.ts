import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { applySurveyRetentionPerTenant, planSurveyRetention, redactedDue } from '@/lib/survey/retention'

// GET /api/cron/survey-retention
// Vercel cron, monthly (see vercel.json). The 7-year survey retention rule
// (lib/survey/retention.ts). Reports what is due to cron_runs and deletes
// nothing unless SURVEY_RETENTION_APPLY=true is set on the deployment — that
// switch is David's decision. The first deletions fall due in 2033.
export const maxDuration = 60

/** Deletions stop starting this long after the run began, clear of maxDuration. */
const APPLY_BUDGET_MS = 45_000

export const GET = withCronAudit('survey-retention', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked
  const started = Date.now()

  const db = supabaseServer()
  const run = await startCronRun(db, 'survey-retention')
  const apply = process.env.SURVEY_RETENTION_APPLY === 'true'
  try {
    const plan = await planSurveyRetention(db)
    const report = {
      apply,
      due: plan.totals,
      dueList: redactedDue(plan).slice(0, 50),
      waiting: plan.waiting,
      inactiveWithoutDate: plan.inactiveWithoutDate,
      emailsHeld: plan.emailsHeld,
    }
    if (!apply || !plan.due.length) {
      await run.finish(report)
      return NextResponse.json(report)
    }
    // Per tenant, inactive tenants included (S5 B13). Failures are recorded on
    // `run` as they happen. When only Stellr has subjects due, ledger is empty
    // and the result is the same as before; notApplied appears only when the
    // time ran out, where a run used to be cut off with no result at all, and
    // then the run also records 'not_applied' so it does not finish ok.
    const { result, notApplied, ledger } = await applySurveyRetentionPerTenant(db, run, plan, 'system:survey-retention', {
      deadline: started + APPLY_BUDGET_MS,
    })
    await run.finish({
      ...report,
      deleted: { people: result.purged, responses: result.responses, invitations: result.invitations },
      ...(notApplied ? { notApplied } : {}),
      ...ledger,
    })
    return NextResponse.json({ ...report, deleted: result.purged, failures: result.failures.length })
  } catch (err) {
    run.fail('plan', err)
    await run.finish({ apply })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
