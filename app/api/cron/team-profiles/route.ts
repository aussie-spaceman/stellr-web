import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { dispatchTeamProfiles } from '@/lib/team-profile/store'

export const maxDuration = 60

// GET /api/cron/team-profiles — the safety net for team profile emails.
// Most go out the moment a student's permission form completes
// (lib/esign/completion.ts) or at registration when paperwork is already on
// file (lib/docusign-agreements.ts). This daily sweep sends any those missed,
// for every upcoming competition. Idempotent: one profile per participant.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'team-profiles')
  try {
    const result = await dispatchTeamProfiles(db, { budgetMs: 45_000 })
    await run.finish({ ...result })
    return NextResponse.json(result)
  } catch (err) {
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
