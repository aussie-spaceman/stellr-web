import type { SupabaseClient } from '@supabase/supabase-js'

// Records a cron invocation in cron_runs (migration 20260928180000). Vercel
// Hobby keeps runtime logs for one hour, so "did the job run, and did it fail?"
// has to be answerable from the database. Best-effort: recording never throws,
// so the ledger can't take down the job it describes.

export interface CronRun {
  /** Append one per-item failure; kept to the first 50. */
  fail(where: string, err: unknown): void
  /** Close the run. ok=false when any failure was recorded. */
  finish(result: Record<string, unknown>): Promise<void>
}

export async function startCronRun(db: SupabaseClient, job: string): Promise<CronRun> {
  const errors: { where: string; message: string }[] = []
  let id: string | null = null
  try {
    const { data, error } = await db.from('cron_runs').insert({ job }).select('id').single()
    if (error) console.error(`[cron-runs] start ${job}:`, error)
    id = (data?.id as string | undefined) ?? null
  } catch (err) {
    console.error(`[cron-runs] start ${job} threw:`, err)
  }

  return {
    fail(where, err) {
      if (errors.length < 50) errors.push({ where, message: err instanceof Error ? err.message : String(err) })
    },
    async finish(result) {
      if (!id) return
      try {
        await db
          .from('cron_runs')
          .update({ finished_at: new Date().toISOString(), ok: errors.length === 0, result, errors })
          .eq('id', id)
      } catch (err) {
        console.error(`[cron-runs] finish ${job} threw:`, err)
      }
    },
  }
}
