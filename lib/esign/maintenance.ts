import type { SupabaseClient } from '@supabase/supabase-js'
import { getProvider } from '@/lib/esign'
import { archivePending } from '@/lib/esign/archive'
import { purgeExpired } from '@/lib/esign/retention'
import { syncDocusignUsage } from '@/lib/esign/routing'

// The daily housekeeping for signed agreements, as one job with independent
// steps: a failing step is recorded and the rest still run.
//
// Called by the daily cron (production only — guardCron), and by the admin
// "Run maintenance now" action, which is the only way to exercise it on the
// dev deployment.

export type MaintenanceStep = 'usage' | 'archive' | 'retention'

export interface MaintenanceOptions {
  dryRun?: boolean
  steps?: MaintenanceStep[]
  /** Records a per-step failure (the cron run ledger's `fail`). */
  onError?: (step: MaintenanceStep, err: unknown) => void
}

const ARCHIVE_BATCH = 20
const PURGE_BATCH = 50

export async function runEsignMaintenance(
  db: SupabaseClient,
  opts: MaintenanceOptions = {},
): Promise<Record<string, unknown>> {
  const steps = new Set<MaintenanceStep>(opts.steps ?? ['usage', 'archive', 'retention'])
  const result: Record<string, unknown> = { dryRun: Boolean(opts.dryRun) }

  const step = async (name: MaintenanceStep, fn: () => Promise<unknown>) => {
    if (!steps.has(name)) return
    try {
      result[name] = await fn()
    } catch (err) {
      result[name] = { error: err instanceof Error ? err.message : String(err) }
      opts.onError?.(name, err)
    }
  }

  await step('usage', async () => {
    if (opts.dryRun) return { skipped: 'dry run' }
    const docusign = getProvider('docusign')
    if (!docusign.getUsage) return { skipped: 'not supported' }
    return syncDocusignUsage(db, () => docusign.getUsage!({ db }))
  })

  await step('archive', () => archivePending(db, { limit: ARCHIVE_BATCH, dryRun: opts.dryRun }))

  await step('retention', () => purgeExpired(db, { limit: PURGE_BATCH, dryRun: opts.dryRun }))

  return result
}
