import type { SupabaseClient } from '@supabase/supabase-js'

// Records a cron invocation in cron_runs (migration 20260928180000). Vercel
// Hobby keeps runtime logs for one hour, so "did the job run, and did it fail?"
// has to be answerable from the database. Best-effort: recording never throws,
// so the ledger can't take down the job it describes.

export interface CronRun {
  /** The ledger row's id, or null when the row could not be written. */
  readonly id: string | null
  /** Append one per-item failure; kept to the first 50. */
  fail(where: string, err: unknown): void
  /** Close the run. ok=false when any failure was recorded. */
  finish(result: Record<string, unknown>): Promise<void>
}

/**
 * The `result` of this job's most recent FINISHED top-level run, or null when
 * there is none or it can't be read. A run killed mid-way never finishes, so it
 * is skipped rather than read as a result. Lets a job carry a cursor from one
 * run to the next without a table of its own.
 *
 * It has to work with or without migration cron_runs_tenant applied, because a
 * failed read here restarts apollo-reconcile's nextOffset cursor. Naming
 * parent_id in the select or a filter is a Postgres error (42703) wherever the
 * column does not exist yet, so the first read asks for `*` and inspects the
 * row. Only a newest row that really is a per-tenant child (startTenantRun)
 * costs a second read, and a child can only exist once the column does.
 */
export async function lastCronResult(db: SupabaseClient, job: string): Promise<Record<string, unknown> | null> {
  try {
    const finishedRuns = () =>
      db.from('cron_runs').select('*').eq('job', job).not('finished_at', 'is', null)

    const newest = await finishedRuns().order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (newest.error) {
      console.error(`[cron-runs] last result ${job}:`, newest.error)
      return null
    }
    if (newest.data?.parent_id == null) {
      return (newest.data?.result as Record<string, unknown> | undefined) ?? null
    }

    const topLevel = await finishedRuns()
      .is('parent_id', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (topLevel.error) {
      console.error(`[cron-runs] last result ${job}:`, topLevel.error)
      return null
    }
    return (topLevel.data?.result as Record<string, unknown> | undefined) ?? null
  } catch (err) {
    console.error(`[cron-runs] last result ${job} threw:`, err)
    return null
  }
}

export async function startCronRun(db: SupabaseClient, job: string): Promise<CronRun> {
  return openRun(db, job, { job })
}

/**
 * A child row for one tenant's share of `parent`, with the same job name. When
 * the parent has no row this writes nothing: a child with a NULL parent_id
 * would read as a top-level run, and lastCronResult would take it for the
 * job's cursor.
 */
export async function startTenantRun(
  db: SupabaseClient,
  parent: CronRun,
  job: string,
  tenantId: string,
): Promise<CronRun> {
  if (!parent.id) return ledgerHandle(db, job, null)
  return openRun(db, job, { job, tenant_id: tenantId, parent_id: parent.id })
}

async function openRun(db: SupabaseClient, job: string, row: Record<string, unknown>): Promise<CronRun> {
  let id: string | null = null
  try {
    const { data, error } = await db.from('cron_runs').insert(row).select('id').single()
    if (error) console.error(`[cron-runs] start ${job}:`, error)
    id = (data?.id as string | undefined) ?? null
  } catch (err) {
    console.error(`[cron-runs] start ${job} threw:`, err)
  }
  return ledgerHandle(db, job, id)
}

function ledgerHandle(db: SupabaseClient, job: string, id: string | null): CronRun {
  const errors: { where: string; message: string }[] = []
  return {
    id,
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
