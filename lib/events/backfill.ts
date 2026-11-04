/**
 * Plan a backfill of the events mirror from every Sanity event document
 * (scripts/backfill-events-mirror.ts). Pure: no I/O, so the dry run and the
 * apply share one tested decision.
 */
import { toEventRow, type EventRow, type SanityEventDoc, type TenantDefaults, STELLR_DEFAULTS } from './sync'

/** The mirror columns compared to decide whether a row changed (synced_at is not). */
const COMPARED: (keyof EventRow)[] = [
  'tenant_id', 'slug', 'title', 'activity_type', 'starts_at', 'ends_at', 'time_zone',
  'country', 'currency', 'grade_system', 'status', 'source_updated_at',
]

/** A mirror row as read back: the key columns plus any of the compared ones. */
export type ExistingMirrorRow = Pick<EventRow, 'sanity_id' | 'slug'> & Partial<EventRow>

export interface BackfillPlan {
  insert: EventRow[]
  update: EventRow[]
  unchanged: string[]
  /** Documents the mirror cannot hold (drafts, no slug, no _id). */
  invalid: string[]
  /** Slug already used by a different event — would violate events_slug_key. */
  conflicts: { slug: string; sanityIds: string[] }[]
}

const sameInstant = (a: unknown, b: unknown) => {
  if (a == null || b == null) return a == b
  const ta = Date.parse(String(a))
  const tb = Date.parse(String(b))
  return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb
}

export function planMirrorBackfill(
  docs: SanityEventDoc[],
  existing: ExistingMirrorRow[],
  tenant: TenantDefaults = STELLR_DEFAULTS,
  now: Date = new Date(),
): BackfillPlan {
  const plan: BackfillPlan = { insert: [], update: [], unchanged: [], invalid: [], conflicts: [] }
  const bySanityId = new Map(existing.map((r) => [r.sanity_id, r]))

  const rows: EventRow[] = []
  for (const doc of docs) {
    const row = toEventRow(doc, tenant, now)
    if (!row) plan.invalid.push(String(doc?._id ?? '(no _id)'))
    else rows.push(row)
  }

  // A slug may belong to one event only: among the incoming documents, and
  // against mirror rows for events not in this batch.
  const slugOwners = new Map<string, Set<string>>()
  for (const r of rows) slugOwners.set(r.slug, (slugOwners.get(r.slug) ?? new Set()).add(r.sanity_id))
  const incomingIds = new Set(rows.map((r) => r.sanity_id))
  for (const e of existing) {
    if (!incomingIds.has(e.sanity_id) && slugOwners.has(e.slug)) slugOwners.get(e.slug)!.add(e.sanity_id)
  }
  const conflicted = new Set<string>()
  for (const [slug, ids] of slugOwners) {
    if (ids.size > 1) {
      plan.conflicts.push({ slug, sanityIds: [...ids].sort() })
      conflicted.add(slug)
    }
  }

  for (const row of rows) {
    if (conflicted.has(row.slug)) continue
    const cur = bySanityId.get(row.sanity_id)
    if (!cur) plan.insert.push(row)
    else {
      const changed = COMPARED.some((k) =>
        k === 'starts_at' || k === 'ends_at' || k === 'source_updated_at' ? !sameInstant(cur[k], row[k]) : (cur[k] ?? null) !== (row[k] ?? null),
      )
      if (changed) plan.update.push(row)
      else plan.unchanged.push(row.slug)
    }
  }
  return plan
}

/**
 * Whether the mirror matches Sanity (scripts/backfill-events-mirror.ts
 * --check). In enforce mode a published event missing from the mirror makes
 * every registration and agreement insert for it fail, and the webhook sync is
 * best-effort (one try, 8 s cap), so the cut-over requires this to be clean
 * and run on a schedule (docs/TENANCY-S3.md). Invalid documents (drafts, no
 * slug) cannot be registered for, so they are not drift.
 */
export function mirrorDrift(plan: BackfillPlan): { ok: boolean; missing: string[]; stale: string[]; conflicts: string[] } {
  const missing = plan.insert.map((r) => r.slug)
  const stale = plan.update.map((r) => r.slug)
  const conflicts = plan.conflicts.map((c) => c.slug)
  return { ok: !missing.length && !stale.length && !conflicts.length, missing, stale, conflicts }
}
