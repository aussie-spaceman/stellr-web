import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { applySurveyRetention, planSurveyRetention, redactedDue } from '@/lib/survey/retention'

// GET /api/cron/survey-retention
// Vercel cron, monthly (see vercel.json). The 7-year survey retention rule
// (lib/survey/retention.ts). Reports what is due to cron_runs and deletes
// nothing unless SURVEY_RETENTION_APPLY=true is set on the deployment — that
// switch is David's decision. The first deletions fall due in 2033.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

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
    const result = await applySurveyRetention(db, plan, 'system:survey-retention')
    for (const f of result.failures) run.fail(`${f.kind}:${f.kind === 'email' ? 'email' : f.id}`, f.error)
    await run.finish({ ...report, deleted: { people: result.purged, responses: result.responses, invitations: result.invitations } })
    return NextResponse.json({ ...report, deleted: result.purged, failures: result.failures.length })
  } catch (err) {
    run.fail('plan', err)
    await run.finish({ apply })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
