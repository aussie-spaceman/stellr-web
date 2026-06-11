import { supabaseServer } from '@/lib/supabase'
import { getEntityDef } from './registry'
import { deletionPreflight } from './preflight'
import { runExternalCleanup } from './external'
import { archiveEntity } from './archive'
import type { DeleteMode, DeletionResult, EntityDef } from './types'

export class DeletionBlockedError extends Error {
  constructor(public blockers: { table: string; label: string; count: number }[]) {
    super('Deletion blocked by linked records')
    this.name = 'DeletionBlockedError'
  }
}

function resolveSoftSet(def: EntityDef): Record<string, unknown> {
  const spec = def.softDelete
  if (!spec) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spec.set)) {
    out[k] = typeof v === 'function' ? (v as () => unknown)() : v
  }
  return out
}

// Orchestrates a single entity deletion:
//  1. preflight — abort if any blocker remains (caller renders the list)
//  2. external cleanup (Stripe / DocuSign), collecting partial failures
//  3. soft: apply soft-delete columns | hard: archive snapshot, then delete rows
export async function executeDeletion(
  entity: string,
  id: string,
  opts: { mode: DeleteMode; deletedBy?: string | null }
): Promise<DeletionResult> {
  const def = getEntityDef(entity)
  if (!def) throw new Error(`Unknown deletable entity type: ${entity}`)

  const mode: DeleteMode = opts.mode === 'soft' && !def.softDelete ? 'hard' : opts.mode

  const pre = await deletionPreflight(entity, id)
  if (!pre.canDelete) throw new DeletionBlockedError(pre.blockers)

  const externalResults = await runExternalCleanup(def, id)

  const db = supabaseServer()

  if (mode === 'soft') {
    const { error } = await db.from(def.table).update(resolveSoftSet(def)).eq(def.pk, id)
    if (error) throw new Error(`Soft delete failed: ${error.message}`)
    return { entity, id, mode, deleted: true, externalResults }
  }

  // Hard purge: snapshot first, then delete primary + spanned rows.
  await archiveEntity(def, id, opts.deletedBy ?? null)

  for (const span of def.spans ?? []) {
    if (span.table === def.table && span.column === def.pk) continue
    const { error } = await db.from(span.table).delete().eq(span.column, id)
    if (error) throw new Error(`Hard delete failed for ${span.table}: ${error.message}`)
  }

  const { error } = await db.from(def.table).delete().eq(def.pk, id)
  if (error) throw new Error(`Hard delete failed: ${error.message}`)

  return { entity, id, mode, deleted: true, externalResults }
}
