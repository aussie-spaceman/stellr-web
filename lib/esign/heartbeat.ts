import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyCommunityAdmins } from '@/lib/notify'

// The DocuSign reminder cron once went three weeks without doing anything and
// nobody could tell (TRACKER 21.1). Every job that keeps signing healthy
// records a cron_runs row; this checks those rows exist, and alerts when one
// has gone quiet. Each job is checked from a DIFFERENT cron than its own, so a
// job that stops entirely is still noticed.

export const SIGNING_JOBS = ['docusign-reminders', 'docusign-form-data', 'esign-maintenance', 'event-emails'] as const

const QUIET_HOURS = 26

export async function quietJobs(
  db: SupabaseClient,
  jobs: readonly string[],
  now = new Date(),
): Promise<string[]> {
  const since = new Date(now.getTime() - QUIET_HOURS * 3_600_000).toISOString()
  const { data } = await db.from('cron_runs').select('job').in('job', [...jobs]).gte('started_at', since)
  const seen = new Set(((data ?? []) as { job: string }[]).map((r) => r.job))
  return jobs.filter((j) => !seen.has(j))
}

/** Alerts admins about jobs with no run in the last day. Returns which were quiet. */
export async function checkHeartbeat(
  db: SupabaseClient,
  jobs: readonly string[],
  now = new Date(),
): Promise<{ quiet: string[] }> {
  const quiet = await quietJobs(db, jobs, now)
  if (quiet.length) {
    const body =
      `These scheduled jobs have not run in the last ${QUIET_HOURS} hours: ${quiet.join(', ')}. ` +
      'Signing reminders, stored copies or signing emails may be held up. Check the Vercel cron configuration ' +
      'and the latest deployment, then run maintenance from Admin → Consent forms.'
    await notifyCommunityAdmins({
      type: 'action',
      body,
      email: { subject: 'Scheduled signing jobs have stopped', html: `<p>${body}</p>`, text: body },
    }).catch(() => {})
  }
  return { quiet }
}
