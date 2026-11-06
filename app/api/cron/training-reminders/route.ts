import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { runTrainingReminders } from '@/lib/training-reminders'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'

// Hobby's ceiling: no lower value is safe to pick without run times to prove it
// (a cron cut short mid-batch loses its run.finish), and it cannot be shorter than
// whatever limit this route ran under before it declared one.
export const maxDuration = 300

// GET /api/cron/training-reminders — runs daily (see vercel.json).
// Reminds participants who haven't finished mandatory training as a deadline
// approaches, and escalates overdue mandatory training to the supervising adult.
// Processes BOTH the legacy event assignments and the new per-Object/per-tier
// assignments; honours each course's reminder & escalation settings. See
// lib/training-reminders.ts for the engine.
export const GET = withCronAudit('training-reminders', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked
  // deep review INT-9: record the run so a failing reminder/escalation engine is
  // visible after Vercel's 1h log retention.
  const db = supabaseServer()
  const run = await startCronRun(db, 'training-reminders')
  try {
    const result = await runTrainingReminders()
    await run.finish(result as unknown as Record<string, unknown>)
    return NextResponse.json(result)
  } catch (err) {
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
})
