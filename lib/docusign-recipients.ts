import type { SupabaseClient } from '@supabase/supabase-js'
import { summariseSigners, type EnvelopeRecipient } from './docusign'
import type { RecipientLike } from './docusign-status'
import { fetchEnvelopeRecipients } from './esign/operations'
import { announceBounces } from './esign/bounce-notices'

// Persistence for agreement_recipients (migration 148): pull the signer
// list from DocuSign and mirror it into the DB so every surface can answer "who
// is outstanding?" without a live API call.

/**
 * Refreshes the recipient rows for one envelope from DocuSign and returns them.
 * Also keeps the legacy signers_total / signers_completed counters on
 * agreements current, so anything still reading those stays correct.
 *
 * Upserts on (envelope_row, recipient_id), which is stable across resends — so
 * this is idempotent under DocuSign Connect's at-least-once delivery.
 *
 * `provider` is the envelope row's own column; omitted, the row is DocuSign's
 * (every row written before the column existed).
 */
export async function syncEnvelopeRecipients(
  db: SupabaseClient,
  envelopeRowId: string,
  envelopeId: string,
  provider?: string | null,
): Promise<EnvelopeRecipient[]> {
  const recipients = await fetchEnvelopeRecipients(db, { envelope_id: envelopeId, provider })
  if (recipients.length === 0) return recipients

  const now = new Date().toISOString()

  // Stellr signing keeps its signer list in this table already: nothing to
  // mirror, only the legacy counters to keep in step.
  if (provider === 'native') {
    const { total, completed } = summariseSigners(recipients)
    await db
      .from('agreements')
      .update({ signers_total: total, signers_completed: completed, updated_at: now })
      .eq('id', envelopeRowId)
    await announceIfBounced(db, envelopeRowId, recipients)
    return recipients
  }

  const { error } = await db
    .from('agreement_recipients')
    .upsert(
      recipients.map((r) => ({
        envelope_row:   envelopeRowId,
        recipient_id:   r.recipientId,
        role_name:      r.roleName,
        name:           r.name,
        email:          r.email,
        status:         r.status,
        routing_order:  r.routingOrder,
        delivered_at:   r.deliveredAt,
        signed_at:      r.signedAt,
        declined_at:    r.declinedAt,
        last_synced_at: now,
      })),
      { onConflict: 'envelope_row,recipient_id' },
    )
  if (error) throw new Error(`Failed to persist envelope recipients: ${error.message}`)

  const { total, completed } = summariseSigners(recipients)
  await db
    .from('agreements')
    .update({ signers_total: total, signers_completed: completed, updated_at: now })
    .eq('id', envelopeRowId)

  await announceIfBounced(db, envelopeRowId, recipients)
  return recipients
}

/**
 * Every sync is a place a bounce can first be seen: Connect, the reminder cron
 * and the roster's Correct email refresh. Announcing from here, rather than from
 * the Connect webhook alone, means a bounce Connect never delivered is still
 * announced. The claim in lib/esign/bounce-notices.ts makes it once per address,
 * whichever sync sees it first. Never throws.
 */
async function announceIfBounced(db: SupabaseClient, envelopeRowId: string, recipients: EnvelopeRecipient[]): Promise<void> {
  if (!recipients.some((r) => r.status === 'autoresponded')) return
  await announceBounces(db, envelopeRowId, { kind: 'bounced' })
}

/** PostgREST caps a response at 1000 rows and a long `.in()` makes an overlong
 * GET URL (414/400); chunk the ids so neither bites at scale (deep review DS-9,
 * matching the lib/survey/media.ts pattern). */
const RECIPIENT_IN_CHUNK = 200

/** Recipient rows for many envelopes at once, keyed by agreements.id. */
export async function loadRecipientsByEnvelopeRows(
  db: SupabaseClient,
  envelopeRowIds: string[],
): Promise<Map<string, RecipientLike[]>> {
  const byRow = new Map<string, RecipientLike[]>()
  const ids = [...new Set(envelopeRowIds.filter(Boolean))]
  if (ids.length === 0) return byRow

  // deep review DS-9: fetch in chunks of RECIPIENT_IN_CHUNK ids. The admin
  // consent-forms page and the member panel pass every envelope id at once, so
  // an unchunked `.in()` silently truncated the recipient list (losing "who is
  // outstanding") and could build an overlong URL as the roster grew.
  const data: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += RECIPIENT_IN_CHUNK) {
    const { data: slice, error } = await db
      .from('agreement_recipients')
      .select('envelope_row, name, email, role_name, status, delivered_at, routing_order, invite_sent_at, envelope:agreements!inner(provider)')
      .in('envelope_row', ids.slice(i, i + RECIPIENT_IN_CHUNK))
      .order('routing_order', { ascending: true })
    if (error) {
      // A missing recipient list degrades the pill to "outstanding signer unknown"
      // (see describeEnvelope) rather than breaking the page. Never fatal.
      console.error('[docusign] recipient load failed (non-fatal):', error.message)
      return byRow
    }
    data.push(...(slice ?? []))
  }

  for (const raw of data) {
    const { envelope, invite_sent_at, ...row } = raw as Record<string, unknown> & {
      envelope?: { provider?: string } | { provider?: string }[] | null
      invite_sent_at?: string | null
    }
    const provider = (Array.isArray(envelope) ? envelope[0] : envelope)?.provider ?? 'docusign'
    // Stellr signing emails its own invitations; DocuSign rows never carry
    // invite_sent_at, and DocuSign emails at the moment it issues.
    const unsent = provider === 'native' && row.status === 'sent' && !invite_sent_at
    const list = byRow.get(row.envelope_row as string) ?? []
    list.push({ ...(row as unknown as RecipientLike), unsent })
    byRow.set(row.envelope_row as string, list)
  }
  return byRow
}
