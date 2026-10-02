import type { SupabaseClient } from '@supabase/supabase-js'
import { summariseSigners, type EnvelopeRecipient } from './docusign'
import type { RecipientLike } from './docusign-status'
import { fetchEnvelopeRecipients } from './esign/operations'
import { notifyCommunityAdmins } from './notify'

// Persistence for docusign_envelope_recipients (migration 148): pull the signer
// list from DocuSign and mirror it into the DB so every surface can answer "who
// is outstanding?" without a live API call.

/**
 * Refreshes the recipient rows for one envelope from DocuSign and returns them.
 * Also keeps the legacy signers_total / signers_completed counters on
 * docusign_envelopes current, so anything still reading those stays correct.
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
      .from('docusign_envelopes')
      .update({ signers_total: total, signers_completed: completed, updated_at: now })
      .eq('id', envelopeRowId)
    return recipients
  }

  const { error } = await db
    .from('docusign_envelope_recipients')
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
    .from('docusign_envelopes')
    .update({ signers_total: total, signers_completed: completed, updated_at: now })
    .eq('id', envelopeRowId)

  return recipients
}

/** Recipient rows for many envelopes at once, keyed by docusign_envelopes.id. */
export async function loadRecipientsByEnvelopeRows(
  db: SupabaseClient,
  envelopeRowIds: string[],
): Promise<Map<string, RecipientLike[]>> {
  const byRow = new Map<string, RecipientLike[]>()
  const ids = [...new Set(envelopeRowIds.filter(Boolean))]
  if (ids.length === 0) return byRow

  const { data, error } = await db
    .from('docusign_envelope_recipients')
    .select('envelope_row, name, email, role_name, status, delivered_at, routing_order, invite_sent_at, envelope:docusign_envelopes!inner(provider)')
    .in('envelope_row', ids)
    .order('routing_order', { ascending: true })
  if (error) {
    // A missing recipient list degrades the pill to "outstanding signer unknown"
    // (see describeEnvelope) rather than breaking the page. Never fatal.
    console.error('[docusign] recipient load failed (non-fatal):', error.message)
    return byRow
  }

  for (const raw of data ?? []) {
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

/**
 * Alerts admins the first time a recipient's address is reported as bounced.
 *
 * DocuSign reports this as recipient status 'autoresponded' and we previously
 * discarded it, so a guardian with a dead address looked exactly like one who
 * was merely slow — the chase emails kept going out and nobody was told the mail
 * was never arriving. Only fires on a transition into 'autoresponded' so a
 * replayed Connect event can't spam the admins.
 */
export async function alertOnNewBounces(
  previous: RecipientLike[],
  current: EnvelopeRecipient[],
  context: { minorName: string; eventTitle: string; participantId: string | null },
): Promise<void> {
  const wasBounced = new Set(
    previous.filter((r) => r.status === 'autoresponded').map((r) => r.email.toLowerCase()),
  )
  const newlyBounced = current.filter(
    (r) => r.status === 'autoresponded' && !wasBounced.has(r.email.toLowerCase()),
  )
  if (newlyBounced.length === 0) return

  const lines = newlyBounced.map((r) => `${r.name} <${r.email}>${r.roleName ? ` — ${r.roleName}` : ''}`)
  await notifyCommunityAdmins({
    type: 'action',
    body: `DocuSign email bounced for ${context.minorName} (${context.eventTitle}): ${lines.join('; ')}. Correct the address and re-issue — reminders will never reach them.`,
    referenceType: 'participant',
    referenceId: context.participantId ?? undefined,
    email: {
      subject: `Action needed: DocuSign email bounced for ${context.minorName}`,
      html: `<p>DocuSign reported a bounced address on the agreement for <strong>${context.minorName}</strong> (${context.eventTitle}):</p><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul><p>Reminders will never reach this address. Correct it and re-issue the envelope.</p>`,
      text: `DocuSign reported a bounced address on the agreement for ${context.minorName} (${context.eventTitle}): ${lines.join('; ')}. Reminders will never reach this address — correct it and re-issue.`,
    },
  }).catch(() => {})
  // Deliberately swallowed: a failed admin notification must never roll back a
  // successful recipient sync.
}
