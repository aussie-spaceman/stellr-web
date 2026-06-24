import { NextRequest, NextResponse } from 'next/server'
import { runTrainingReminders } from '@/lib/training-reminders'

// GET /api/cron/training-reminders — runs daily (see vercel.json).
// Reminds participants who haven't finished mandatory training as a deadline
// approaches, and escalates overdue mandatory training to the supervising adult.
// Processes BOTH the legacy event assignments and the new per-Object/per-tier
// assignments; honours each course's reminder & escalation settings. See
// lib/training-reminders.ts for the engine.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runTrainingReminders()
  return NextResponse.json(result)
}
