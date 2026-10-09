import { supabaseServer } from '@/lib/supabase'
import { getEntityDef } from './registry'
import { deletionPreflight } from './preflight'
import { runExternalCleanup } from './external'
import { archiveEntity } from './archive'
import { retainSignedRecords, startRetentionClock } from '@/lib/esign/retention'
import { tombstoneCredentialsFor } from '@/lib/credentials'
import { purgeSurveyDataFor } from '@/lib/survey/purge'
import { removeEventParticipation } from '@/lib/event-participation-sync'
import { executeRefund, type RefundChoice, type RefundResult } from '@/lib/refunds/execute'
import type { DeleteMode, DeletionResult, EntityDef } from './types'

type Db = ReturnType<typeof supabaseServer>

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
  opts: { mode: DeleteMode; deletedBy?: string | null; refundChoice?: RefundChoice; refundNote?: string | null }
): Promise<DeletionResult & { refunds: RefundResult[] }> {
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
  // The results go back to the dialog so a failed refund (manual_required) is
  // shown to the admin instead of only landing in event_refunds.
  const refunds: RefundResult[] = []
  if (opts.refundChoice) {
    if (def.type === 'participant') {
      refunds.push(await executeRefund(id, opts.refundChoice, opts.deletedBy ?? null, opts.refundNote))
    } else if (def.type === 'registration') {
      const { data: parts } = await db.from('participants').select('id').eq('registration_id', id)
      for (const part of parts ?? []) {
        refunds.push(await executeRefund((part as { id: string }).id, opts.refundChoice, opts.deletedBy ?? null, opts.refundNote))
      }
    }
  }

  const externalResults = await runExternalCleanup(def, id, mode)

  if (mode === 'soft') {
    const { error } = await db.from(def.table).update(resolveSoftSet(def)).eq(def.pk, id)
    if (error) throw new Error(`Soft delete failed: ${error.message}`)
    // A deactivated account's signed agreements are kept 7 more years (V2.3).
    if (def.type === 'member') await startRetentionClock(db, id)
    // deep review MP-11: the credential tombstone used to run here too, so a
    // *soft* delete (a recoverable deactivation — the default for a member)
    // irreversibly blanked every credential name with no way to restore them.
    // Tombstoning is right-to-erasure and belongs on the HARD path only; a
    // deactivated member keeps their issued credentials (Privacy §10 retains
    // what is needed to verify credentials for 7 years).
    return { entity, id, mode, deleted: true, externalResults, refunds }
  }

  // deep review MP-2: a person's credentials outlive them only as tombstones —
  // the number still resolves (a verifier with a CV gets "withdrawn", not a
  // 404), but the name is gone and the page is private. This MUST run before
  // the rows are removed: the credentials FKs are ON DELETE SET NULL, so once a
  // participant (or member) is gone an event credential issued with a null
  // member_id — a student who had no account at award time — is left orphaned
  // (both FKs null) and no later tombstone run can ever find it again. A member
  // tombstone also has to reach credentials hanging off that member's
  // participant rows, and "delete a group" (registration) has to reach every
  // student's event credential, or the name (and a public page) survives the
  // erasure. All of this is hard-delete only (see the soft branch above).
  await tombstonePersonCredentials(db, def, id)

  // deep review REG-10: event Space access is inherited from the cohort roster
  // and reconcileEventSpaceRoster re-grants it from the ACTIVE roster, so simply
  // deleting the participant/registration row leaves the member in the event
  // Space (full of minors) and the next registration for that event silently
  // restores it. Capture who is leaving which event BEFORE the rows go, then
  // tear the access down AFTER the delete (so the "still has another active
  // participant" guard sees the post-delete state).
  const leavingEvents = await participantsLeavingEvent(db, def, id)

  // Signed agreements outlive the person for their retention period: restrict
  // them and drop only the unsigned ones, before any row is removed (the
  // participant FK is SET NULL, so the signed rows survive the delete below).
  if (def.type === 'participant' || def.type === 'registration' || def.type === 'member') {
    await retainSignedRecords(db, { kind: def.type, id })
  }

  // Survey responses are deleted outright, never archived or de-identified
  // (lib/survey/purge.ts). Before the snapshot, so none of it lands there.
  if (def.type === 'participant' || def.type === 'registration' || def.type === 'member') {
    await purgeSurveyDataFor(db, def.type, id, opts.deletedBy ?? 'deletion')
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

  // deep review REG-10: now the rows are gone, revoke each departed member's
  // inherited event Space access (and delete the auto-created participation
  // row). removeEventParticipation no-ops for anyone who still holds another
  // active participant on the event, so a member registered twice keeps access.
  for (const l of leavingEvents) {
    await removeEventParticipation(db, { memberId: l.memberId, eventSlug: l.eventSlug })
  }

  return { entity, id, mode, deleted: true, externalResults, refunds }
}

// deep review MP-2: tombstone every credential tied to the person(s) this
// deletion removes, matching by BOTH the member link and the participant link
// so an event credential issued with a null member_id (no account at award
// time) is still caught before its FK is nulled.
async function tombstonePersonCredentials(db: Db, def: EntityDef, id: string): Promise<void> {
  if (def.type === 'member') {
    await tombstoneCredentialsFor(db, 'member', id)
    // Event credentials issued before the student's account was linked carry a
    // participant_id but a null member_id, so a member-only tombstone misses
    // them — reach them through the member's participant rows.
    const { data: parts } = await db.from('participants').select('id').eq('member_id', id)
    for (const p of parts ?? []) await tombstoneCredentialsFor(db, 'participant', (p as { id: string }).id)
  } else if (def.type === 'participant') {
    await tombstoneCredentialsFor(db, 'participant', id)
  } else if (def.type === 'registration') {
    // "Delete a group" cascades the participants; tombstone each student's event
    // credential first, or the cascade nulls the link and strands the name.
    const { data: parts } = await db.from('participants').select('id').eq('registration_id', id)
    for (const p of parts ?? []) await tombstoneCredentialsFor(db, 'participant', (p as { id: string }).id)
  }
}

// deep review REG-10: resolve the (member, event) pairs whose event Space access
// must be revoked after a participant or group deletion. Member deletions are
// NOT handled here — the member FK on cohort_members / community_space_members /
// event_participations is ON DELETE CASCADE, so a purged member's roster and
// Space rows go with them and the reconcile net can't re-grant a member that no
// longer exists.
async function participantsLeavingEvent(
  db: Db,
  def: EntityDef,
  id: string,
): Promise<{ memberId: string; eventSlug: string }[]> {
  if (def.type === 'participant') {
    const { data: p } = await db
      .from('participants')
      .select('member_id, registrations(event_slug)')
      .eq('id', id)
      .maybeSingle()
    const memberId = (p?.member_id as string | null) ?? null
    const reg = p?.registrations as { event_slug?: string | null } | { event_slug?: string | null }[] | null
    const eventSlug = (Array.isArray(reg) ? reg[0]?.event_slug : reg?.event_slug) ?? null
    return memberId && eventSlug ? [{ memberId, eventSlug }] : []
  }
  if (def.type === 'registration') {
    const { data: reg } = await db.from('registrations').select('event_slug').eq('id', id).maybeSingle()
    const eventSlug = (reg?.event_slug as string | null) ?? null
    if (!eventSlug) return []
    const { data: parts } = await db.from('participants').select('member_id').eq('registration_id', id)
    return (parts ?? [])
      .map((p) => (p as { member_id: string | null }).member_id)
      .filter((m): m is string => Boolean(m))
      .map((memberId) => ({ memberId, eventSlug }))
  }
  return []
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
