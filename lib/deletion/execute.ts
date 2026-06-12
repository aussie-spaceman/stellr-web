import { supabaseServer } from '@/lib/supabase'
import { getEntityDef } from './registry'
import { deletionPreflight } from './preflight'
import { runExternalCleanup } from './external'
import { archiveEntity } from './archive'
import { executeRefund, type RefundChoice } from '@/lib/refunds/execute'
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
  opts: { mode: DeleteMode; deletedBy?: string | null; refundChoice?: RefundChoice }
): Promise<DeletionResult> {
  const def = getEntityDef(entity)
  if (!def) throw new Error(`Unknown deletable entity type: ${entity}`)

  const mode: DeleteMode = opts.mode === 'soft' && !def.softDelete ? 'hard' : opts.mode

  const pre = await deletionPreflight(entity, id)
  if (!pre.canDelete) throw new DeletionBlockedError(pre.blockers)

  const db = supabaseServer()

  // Refund paid registrations BEFORE the row is removed (we need participant
  // data + payment refs to still exist). Runs only when the admin supplied a
  // choice and the entity is a participant or a registration ("delete group"
  // refunds every paid participant).
  if (opts.refundChoice) {
    if (def.type === 'participant') {
      await executeRefund(id, opts.refundChoice, opts.deletedBy ?? null)
    } else if (def.type === 'registration') {
      const { data: parts } = await db.from('participants').select('id').eq('registration_id', id)
      for (const part of parts ?? []) {
        await executeRefund((part as { id: string }).id, opts.refundChoice, opts.deletedBy ?? null)
      }
    }
  }

  const externalResults = await runExternalCleanup(def, id)

  if (mode === 'soft') {
    const { error } = await db.from(def.table).update(resolveSoftSet(def)).eq(def.pk, id)
    if (error) throw new Error(`Soft delete failed: ${error.message}`)
    return { entity, id, mode, deleted: true, externalResults }
  }

  // Hard purge: snapshot first, then delete primary + spanned rows.
  await archiveEntity(def, id, opts.deletedBy ?? null)

  // Deleting the sole attendee of an individual registration leaves an empty
  // booking behind. For individual registrations that's just clutter, so we
  // withdraw the now-empty registration after the participant is gone. (Group
  // registrations are deliberately left intact — the container lives all season
  // and carries DPA/financial state independent of any one student.) Capture
  // the registration id now, before the participant row disappears.
  const emptiedIndividualReg = def.type === 'participant' ? await individualRegToTidy(db, id) : null

  for (const span of def.spans ?? []) {
    if (span.table === def.table && span.column === def.pk) continue
    const { error } = await db.from(span.table).delete().eq(span.column, id)
    if (error) throw new Error(`Hard delete failed for ${span.table}: ${error.message}`)
  }

  const { error } = await db.from(def.table).delete().eq(def.pk, id)
  if (error) throw new Error(`Hard delete failed: ${error.message}`)

  if (emptiedIndividualReg) {
    // Soft withdraw — preserves the DPA/financial/audit record while removing it
    // from the active roster (the roster query excludes status='withdrawn').
    await db
      .from('registrations')
      .update({ status: 'withdrawn', withdrawn_at: new Date().toISOString() })
      .eq('id', emptiedIndividualReg)
  }

  return { entity, id, mode, deleted: true, externalResults }
}

// Returns the registration id if the given participant is the last remaining
// attendee on an individual registration (so it should be withdrawn once the
// participant is deleted); otherwise null.
async function individualRegToTidy(
  db: ReturnType<typeof supabaseServer>,
  participantId: string
): Promise<string | null> {
  const { data: p } = await db
    .from('participants')
    .select('registration_id')
    .eq('id', participantId)
    .maybeSingle()
  const regId = (p?.registration_id as string | undefined) ?? null
  if (!regId) return null

  const { data: reg } = await db
    .from('registrations')
    .select('type, status')
    .eq('id', regId)
    .maybeSingle()
  if (reg?.type !== 'individual' || reg?.status === 'withdrawn') return null

  const { count } = await db
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .eq('registration_id', regId)
  // count includes the participant we're about to delete; <=1 means it'll be empty.
  return (count ?? 0) <= 1 ? regId : null
}
