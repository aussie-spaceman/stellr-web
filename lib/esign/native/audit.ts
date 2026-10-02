import type { SupabaseClient } from '@supabase/supabase-js'

// The native engine's audit trail. Every write goes through the database
// function esign_append_audit, which chains each entry to the previous one for
// the same agreement under a per-agreement lock (migration 20261002180802).

export type AuditEvent =
  | 'issued' | 'invite_sent' | 'viewed' | 'consented' | 'attested' | 'field_completed'
  | 'signed' | 'declined' | 'countersigned' | 'sealed' | 'completed' | 'voided'
  | 'reminded' | 'downloaded' | 'restricted' | 'archived'

export interface AuditEntry {
  envelopeRow: string
  recipientRow?: string | null
  event: AuditEvent
  ip?: string | null
  userAgent?: string | null
  detail?: Record<string, unknown>
}

export interface AuditRow {
  id: number
  envelope_row: string
  recipient_row: string | null
  event: AuditEvent
  at: string
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown>
  prev_hash: string | null
  hash: string
}

/** User agents are kept, but not without bound. */
const MAX_UA = 400

/**
 * Appends an entry. Throws on failure: an unrecorded signature is not a
 * signature, so callers recording signing steps must not carry on without it.
 */
export async function appendAudit(db: SupabaseClient, entry: AuditEntry): Promise<AuditRow> {
  const { data, error } = await db.rpc('esign_append_audit', {
    p_envelope: entry.envelopeRow,
    p_recipient: entry.recipientRow ?? null,
    p_event: entry.event,
    p_ip: entry.ip ?? null,
    p_ua: entry.userAgent ? entry.userAgent.slice(0, MAX_UA) : null,
    p_detail: entry.detail ?? {},
  })
  if (error || !data) throw new Error(`Audit trail write failed (${entry.event}): ${error?.message ?? 'no row returned'}`)
  return (Array.isArray(data) ? data[0] : data) as AuditRow
}

/** Appends an entry, logging rather than throwing. For events after the fact. */
export async function appendAuditQuietly(db: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    await appendAudit(db, entry)
  } catch (err) {
    console.error('[esign-audit]', err)
  }
}

export async function loadAudit(db: SupabaseClient, envelopeRow: string): Promise<AuditRow[]> {
  const { data, error } = await db
    .from('esign_audit_events')
    .select('*')
    .eq('envelope_row', envelopeRow)
    .order('id', { ascending: true })
  if (error) throw new Error(`Audit trail read failed: ${error.message}`)
  return (data ?? []) as AuditRow[]
}

/** The id of the first entry that no longer matches its hash, or null if intact. */
export async function verifyAudit(db: SupabaseClient, envelopeRow: string): Promise<number | null> {
  const { data, error } = await db.rpc('esign_verify_audit', { p_envelope: envelopeRow })
  if (error) throw new Error(`Audit trail check failed: ${error.message}`)
  return (data as number | null) ?? null
}
