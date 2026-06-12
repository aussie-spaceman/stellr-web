import { supabaseServer } from '@/lib/supabase'
import type { EntityDef } from './types'

// Writes a JSON snapshot of a row (and, for composite entities, all spanned
// rows) into deletion_archive before a hard purge, so support can recover data.
//
// Best-effort by design: the snapshot is an audit/recovery convenience, not a
// precondition for deletion. If it fails (e.g. the deletion_archive table isn't
// present yet, or RLS blocks the insert) we log and let the delete proceed —
// otherwise a missing audit table would block legitimate deletions (this is
// what stopped group-participant removal before migration 026 was applied).
export async function archiveEntity(def: EntityDef, id: string, deletedBy: string | null): Promise<void> {
  try {
    const db = supabaseServer()

    const snapshot: Record<string, unknown> = {}

    // Primary row(s).
    const { data: primary } = await db.from(def.table).select('*').eq(def.pk, id)
    snapshot[def.table] = primary ?? []

    // Spanned tables (composite entities such as events).
    for (const span of def.spans ?? []) {
      if (span.table === def.table && span.column === def.pk) continue
      const { data } = await db.from(span.table).select('*').eq(span.column, id)
      snapshot[span.table] = data ?? []
    }

    const { error } = await db.from('deletion_archive').insert({
      entity_type: def.type,
      entity_id: id,
      snapshot,
      deleted_by: deletedBy,
    })
    if (error) console.error(`[deletion] archive snapshot skipped for ${def.type}/${id}: ${error.message}`)
  } catch (e) {
    console.error(`[deletion] archive snapshot threw for ${def.type}/${id}:`, e)
  }
}
