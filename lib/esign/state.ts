import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  countDocusignIssuedSince,
  effectiveCap,
  estimatedUsage,
  loadProviderState,
  periodStart,
  type ProviderState,
} from '@/lib/esign/routing'
import { canIssue } from '@/lib/esign'

// What the admin "E-signature engine" card shows, and the changes it may make.

const AGREEMENT_TYPES = ['minor', 'adult', 'mentor', 'volunteer', 'membership'] as const

/**
 * Supabase Free includes 1 GB of file storage for the whole project, shared
 * with every other bucket. Signed records are the part that only grows, so the
 * card warns well before they could fill it. Override with
 * ESIGN_STORAGE_LIMIT_BYTES after a plan change.
 */
export const STORAGE_LIMIT_BYTES = Number(process.env.ESIGN_STORAGE_LIMIT_BYTES) || 1024 ** 3

/** The share of the limit at which admins are warned. */
export const STORAGE_WARN_RATIO = 0.7

export interface StorageSummary {
  documents: number
  bytes: number
  limitBytes: number
  /** At or past STORAGE_WARN_RATIO of the limit. */
  warn: boolean
}

export function storageSummary(documents: number, bytes: number, limitBytes = STORAGE_LIMIT_BYTES): StorageSummary {
  return { documents, bytes, limitBytes, warn: bytes >= limitBytes * STORAGE_WARN_RATIO }
}

export const stateUpdateSchema = z.object({
  mode: z.enum(['auto', 'docusign_only', 'overflow_only']).optional(),
  monthlyCap: z.number().int().min(0).max(10_000).optional(),
  reserve: z.number().int().min(0).max(100).optional(),
  overflowTypes: z.array(z.enum(AGREEMENT_TYPES)).max(AGREEMENT_TYPES.length).optional(),
  overflowAllowlist: z.array(z.string().trim().toLowerCase().email()).max(50).optional(),
  /** Clears DocuSign's "allowance spent" flag, e.g. after buying more envelopes. */
  clearExhausted: z.literal(true).optional(),
}).strict()

export type StateUpdate = z.infer<typeof stateUpdateSchema>

export interface EngineSummary {
  state: ProviderState
  nativeAvailable: boolean
  periodStart: string
  issuedThisPeriod: number
  estimatedUsed: number
  usableAllowance: number
  /** Which engine an ordinary (non-allowlisted) agreement would go to right now. */
  currentEngine: 'docusign' | 'native'
  archive: { unarchived: number; failing: number }
  /** Signed records stored here, against the Supabase plan's storage limit. */
  storage: StorageSummary
  restricted: number
  lastRuns: { job: string; started_at: string; ok: boolean | null }[]
}

export async function loadEngineSummary(db: SupabaseClient, now = new Date()): Promise<EngineSummary> {
  const state = await loadProviderState(db)
  const start = periodStart(state, now)
  const [issuedThisPeriod, issuedSinceSync] = await Promise.all([
    countDocusignIssuedSince(db, start),
    state.accountSyncedAt ? countDocusignIssuedSince(db, new Date(state.accountSyncedAt)) : Promise.resolve(0),
  ])
  const facts = { type: 'adult', signerEmails: [], nativeAvailable: canIssue('native'), issuedThisPeriod, issuedSinceSync, now }
  const used = estimatedUsage(state, facts)
  const cap = effectiveCap(state)

  const exhausted = !!state.exhaustedUntil && new Date(state.exhaustedUntil) > now
  const currentEngine: 'docusign' | 'native' =
    !facts.nativeAvailable || state.mode === 'docusign_only'
      ? 'docusign'
      : state.mode === 'overflow_only' || exhausted || used >= cap
        ? 'native'
        : 'docusign'

  const envelopes = () => db.from('docusign_envelopes').select('id', { count: 'exact', head: true })

  const [unarchived, failing, documents, restricted, runs] = await Promise.all([
    envelopes().eq('status', 'completed').is('reused_from', null).is('archived_at', null),
    envelopes().eq('status', 'completed').is('archived_at', null).gt('archive_attempts', 0),
    db.from('docusign_envelopes')
      .select('signed_pdf_bytes, certificate_bytes', { count: 'exact' })
      .not('signed_pdf_path', 'is', null),
    envelopes().not('restricted_at', 'is', null),
    db.from('cron_runs')
      .select('job, started_at, ok')
      .in('job', ['esign-maintenance', 'docusign-reminders', 'docusign-form-data'])
      .order('started_at', { ascending: false })
      .limit(6),
  ])

  return {
    state,
    nativeAvailable: facts.nativeAvailable,
    periodStart: start.toISOString(),
    issuedThisPeriod,
    estimatedUsed: used,
    usableAllowance: cap,
    currentEngine,
    archive: { unarchived: unarchived.count ?? 0, failing: failing.count ?? 0 },
    storage: storageSummary(
      documents.count ?? 0,
      ((documents.data ?? []) as { signed_pdf_bytes: number | null; certificate_bytes: number | null }[])
        .reduce((sum, r) => sum + (r.signed_pdf_bytes ?? 0) + (r.certificate_bytes ?? 0), 0),
    ),
    restricted: restricted.count ?? 0,
    lastRuns: (runs.data ?? []) as { job: string; started_at: string; ok: boolean | null }[],
  }
}

export async function applyStateUpdate(
  db: SupabaseClient,
  update: StateUpdate,
  actor: string,
): Promise<void> {
  const row: Record<string, unknown> = { updated_by: actor, updated_at: new Date().toISOString() }
  if (update.mode) row.mode = update.mode
  if (update.monthlyCap !== undefined) row.monthly_cap = update.monthlyCap
  if (update.reserve !== undefined) row.reserve = update.reserve
  if (update.overflowTypes) row.overflow_types = update.overflowTypes
  if (update.overflowAllowlist) row.overflow_allowlist = update.overflowAllowlist
  if (update.clearExhausted) {
    row.exhausted_until = null
    row.exhausted_reason = null
  }
  const { error } = await db.from('esign_provider_state').update(row).eq('id', true)
  if (error) throw new Error(`Updating the signing engine settings failed: ${error.message}`)
}
