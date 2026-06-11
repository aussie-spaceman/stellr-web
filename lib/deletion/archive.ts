import { supabaseServer } from '@/lib/supabase'
import type { EntityDef } from './types'

// Writes a JSON snapshot of a row (and, for composite entities, all spanned
// rows) into deletion_archive before a hard purge, so support can recover data.
export async function archiveEntity(def: EntityDef, id: string, deletedBy: string | null): Promise<void> {
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

  await db.from('deletion_archive').insert({
    entity_type: def.type,
    entity_id: id,
    snapshot,
    deleted_by: deletedBy,
  })
}
