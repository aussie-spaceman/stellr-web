import type { SupabaseClient } from '@supabase/supabase-js'
import { getProvider } from '@/lib/esign'
import { archivePending } from '@/lib/esign/archive'
import { expireUnsigned, purgeExpired } from '@/lib/esign/retention'
import { purgeRequests } from '@/lib/privacy-requests'
import { syncDocusignUsage } from '@/lib/esign/routing'
import { drainOutbox } from '@/lib/esign/outbox'
import { finaliseStalled } from '@/lib/esign/native/flow'
import { sealPending } from '@/lib/esign/native/certificate-seal'
import { retryFailedIssues } from '@/lib/esign/reconcile'
import { backupConfigured } from '@/lib/esign/backup-crypto'
import { driveBackupStore, type BackupStore } from '@/lib/esign/backup-store'
import { exportTables, replicatePending } from '@/lib/esign/replicate'
import { checkIntegrity } from '@/lib/esign/integrity'
import { checkHeartbeat } from '@/lib/esign/heartbeat'

// The daily housekeeping for signed agreements, as one job with independent
// steps: a failing step is recorded and the rest still run.
//
// Called by the daily cron (production only — guardCron), and by the admin
// "Run maintenance now" action, which is the only way to exercise it on the
// dev deployment.

export type MaintenanceStep =
  | 'usage' | 'finalise' | 'reconcile' | 'outbox' | 'archive' | 'seal'
  | 'replicate' | 'export' | 'integrity' | 'retention' | 'heartbeat'

export const ALL_STEPS: MaintenanceStep[] = [
  'usage', 'finalise', 'reconcile', 'outbox', 'archive', 'seal', 'replicate', 'export', 'integrity', 'retention', 'heartbeat',
]

export interface MaintenanceOptions {
  dryRun?: boolean
  steps?: MaintenanceStep[]
  /** Records a per-step failure (the cron run ledger's `fail`). */
  onError?: (step: MaintenanceStep, err: unknown) => void
  /** Overrides the off-site store (tests). */
  store?: BackupStore | null
}

const ARCHIVE_BATCH = 20
const PURGE_BATCH = 50

export async function runEsignMaintenance(
  db: SupabaseClient,
  opts: MaintenanceOptions = {},
): Promise<Record<string, unknown>> {
  const steps = new Set<MaintenanceStep>(opts.steps ?? ALL_STEPS)
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

  // The off-site store, when configured. Without it the backup steps say so
  // rather than failing, so a deployment without the key still runs the rest.
  let store: BackupStore | null = opts.store ?? null
  if (opts.store === undefined && backupConfigured()) {
    try { store = driveBackupStore() } catch (err) { opts.onError?.('replicate', err) }
  }
  const noStore = { skipped: 'off-site backup not configured (ESIGN_BACKUP_KEY, ESIGN_BACKUP_DRIVE_FOLDER_ID)' }

  await step('usage', async () => {
    if (opts.dryRun) return { skipped: 'dry run' }
    const docusign = getProvider('docusign')
    if (!docusign.getUsage) return { skipped: 'not supported' }
    return syncDocusignUsage(db, () => docusign.getUsage!({ db }))
  })

  // Agreements everyone has signed but that never finished sealing.
  await step('finalise', async () => (opts.dryRun ? { skipped: 'dry run' } : finaliseStalled(db)))

  // Agreements that could not be issued on any engine: try again.
  await step('reconcile', () => retryFailedIssues(db, { dryRun: opts.dryRun }))

  // Signing emails still waiting for the daily budget.
  await step('outbox', async () => (opts.dryRun ? { skipped: 'dry run' } : drainOutbox(db)))

  await step('archive', () => archivePending(db, { limit: ARCHIVE_BATCH, dryRun: opts.dryRun }))

  // Certificate seal for anything still carrying only the hash seal, including
  // agreements signed before the certificate was set up. Before 'replicate',
  // so the off-site copy is the sealed file.
  await step('seal', () => sealPending(db, { limit: ARCHIVE_BATCH, dryRun: opts.dryRun }))

  await step('replicate', async () => {
    if (!store) return noStore
    if (opts.dryRun) return { skipped: 'dry run' }
    return replicatePending(db, store)
  })

  await step('export', async () => {
    if (!store) return noStore
    if (opts.dryRun) return { skipped: 'dry run' }
    return exportTables(db, store)
  })

  await step('integrity', async () => (opts.dryRun ? { skipped: 'dry run' } : checkIntegrity(db)))

  await step('retention', async () => ({
    purged: await purgeExpired(db, { limit: PURGE_BATCH, dryRun: opts.dryRun, store }),
    unsignedExpired: await expireUnsigned(db, { limit: PURGE_BATCH, dryRun: opts.dryRun }),
    // Privacy requests never confirmed (30 days) and answered ones past 3 years.
    privacyRequests: opts.dryRun ? { skipped: 'dry run' } : await purgeRequests(db),
  }))

  // This job checks the others; the reminder cron checks this one.
  await step('heartbeat', async () =>
    opts.dryRun ? { skipped: 'dry run' } : checkHeartbeat(db, ['docusign-reminders', 'event-emails']))

  return result
}
