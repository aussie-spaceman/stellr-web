import { randomUUID } from 'crypto'
import type { EnvelopeRecipient } from '@/lib/docusign'
import { CorrectionRefusedError, type CreatedAgreement, type EsignProvider } from '@/lib/esign/types'
import { planAgreement } from '@/lib/esign/native/plan'
import type { Role } from '@/lib/esign/native/template'
import { loadActiveTemplate } from '@/lib/esign/native/templates-store'
import {
  insertSigners,
  loadEnvelopeByExternalId,
  loadRecipients,
  roleOf,
  type NativeRecipient,
} from '@/lib/esign/native/flow'
import { appendAudit } from '@/lib/esign/native/audit'
import { sendInvites, signNowUrlFor } from '@/lib/esign/outbox'
import { SIGNED_BUCKET } from '@/lib/esign/storage'
import { SIGN_LINK_TTL_SECONDS, signingConfigured } from '@/lib/esign/native/tokens'

// The prefill fields that print each signer's own email on the document. A
// correction rewrites them only while nobody has signed (see correctRecipient).
const EMAIL_PREFILL: Record<Role, string[]> = {
  guardian: ['GuardianEmail'],
  student: ['MinorEmail'],
  adult: ['TeacherEmail'],
  mentor: ['MentorEmail'],
  member: ['MemberEmail', 'MinorEmail'],
  stellr: [],
}

// A signer whose address can still change: not yet signed or declined.
const CORRECTABLE_RECIPIENT = new Set(['created', 'sent', 'delivered', 'autoresponded'])

function toRecipient(r: NativeRecipient) {
  return {
    recipientId: r.recipient_id,
    roleName: r.role_name,
    name: r.name,
    email: r.email,
    status: r.status,
    routingOrder: r.routing_order,
    deliveredAt: r.delivered_at,
    signedAt: r.signed_at,
    declinedAt: r.declined_at,
  }
}

// Stellr signing behind the provider interface. Agreements live in the same
// tables as DocuSign's (provider = 'native'); the signer list, signing state
// and audit trail are this engine's own.

export const nativeProvider: EsignProvider = {
  id: 'native',
  sendsOwnEmails: false,

  async create({ db }, req): Promise<CreatedAgreement> {
    if (!signingConfigured()) throw new Error('Stellr signing is not configured (ESIGN_TOKEN_SECRET)')
    const plan = planAgreement(req)
    const template = await loadActiveTemplate(db, plan.templateKey)

    return {
      provider: 'native',
      externalId: `native-${randomUUID()}`,
      signerCount: plan.signers.length,
      rowFields: {
        template_id: template.id,
        prefill: plan.subjectBirthYear ? { ...plan.prefill, SubjectBirthYear: plan.subjectBirthYear } : plan.prefill,
      },
      async afterRecord(db2, envelopeRowId) {
        const active = await insertSigners(db2, envelopeRowId, plan, template)
        // The signing emails go out now where the day's email budget allows;
        // the rest wait in the outbox for the next send window.
        await sendInvites(db2, active)
        // A signer with an account who is already in front of us (an adult
        // joining, a mentor signing up) can sign without waiting for an email.
        const self = req.accounts?.memberId
          ? active.find((r) => r.member_id && r.member_id === req.accounts?.memberId)
          : undefined
        return { signNowUrl: self ? signNowUrlFor(self) : null }
      },
    }
  },

  async getRecipients({ db }, externalId): Promise<EnvelopeRecipient[]> {
    const env = await loadEnvelopeByExternalId(db, externalId)
    if (!env) return []
    return (await loadRecipients(db, env.id)).map(toRecipient)
  },

  async remind({ db }, externalId) {
    const env = await loadEnvelopeByExternalId(db, externalId)
    if (!env || !['sent', 'delivered'].includes(env.status)) return 0
    const due = (await loadRecipients(db, env.id)).filter((r) => r.status === 'sent' || r.status === 'delivered')
    if (!due.length) return 0
    // A reminder renews the link's life: a parent chased on day 28 must not
    // get a link that dies on day 30.
    const expires = new Date(Date.now() + SIGN_LINK_TTL_SECONDS * 1000).toISOString()
    await db.from('agreement_recipients').update({ token_expires_at: expires }).in('id', due.map((r) => r.id))
    const result = await sendInvites(db, due.map((r) => ({ ...r, token_expires_at: expires })), { reminder: true })
    await appendAudit(db, { envelopeRow: env.id, event: 'reminded', detail: { recipients: due.length, sent: result.sent } })
    return due.length
  },

  async void({ db }, externalId, reason) {
    const env = await loadEnvelopeByExternalId(db, externalId)
    if (!env) return
    if (['completed', 'declined', 'voided'].includes(env.status)) {
      throw new Error(`Agreement is ${env.status}; nothing to void`)
    }
    const now = new Date().toISOString()
    // Every outstanding link dies with the agreement.
    for (const r of await loadRecipients(db, env.id)) {
      if (r.status !== 'completed') {
        await db.from('agreement_recipients').update({ token_version: r.token_version + 1 }).eq('id', r.id)
      }
    }
    await db.from('agreements').update({ status: 'voided', updated_at: now }).eq('id', env.id)
    await appendAudit(db, { envelopeRow: env.id, event: 'voided', detail: { reason: reason ?? 'Voided by Stellr' } })
  },

  async correctRecipient({ db }, externalId, correction) {
    const env = await loadEnvelopeByExternalId(db, externalId)
    if (!env) throw new CorrectionRefusedError('native', 'Agreement not found', 'ENVELOPE_NOT_FOUND')
    if (!['sent', 'delivered'].includes(env.status)) {
      throw new CorrectionRefusedError(
        'native',
        `This agreement is ${env.status}; only one still out for signature can be corrected`,
        'ENVELOPE_NOT_CORRECTABLE',
      )
    }
    const recipients = await loadRecipients(db, env.id)
    const target = recipients.find((r) => r.recipient_id === correction.recipientId)
    if (!target) {
      throw new CorrectionRefusedError('native', `Signer ${correction.recipientId} is not on this agreement`, 'RECIPIENT_NOT_FOUND')
    }
    if (!CORRECTABLE_RECIPIENT.has(target.status)) {
      throw new CorrectionRefusedError(
        'native',
        `${target.name || 'This signer'} has already ${target.status === 'declined' ? 'declined' : 'signed'}; their address cannot be changed`,
        'RECIPIENT_FINISHED',
      )
    }

    const email = correction.email.trim().toLowerCase()
    const name = correction.name?.trim() || target.name
    // A bounced signer was active, so they go back to waiting on the new email.
    // A queued one stays queued until their turn.
    const status = target.status === 'autoresponded' ? 'sent' : target.status
    const due = status === 'sent' || status === 'delivered'
    const expires = due ? new Date(Date.now() + SIGN_LINK_TTL_SECONDS * 1000).toISOString() : target.token_expires_at
    const { error } = await db
      .from('agreement_recipients')
      .update({
        email,
        name,
        status,
        // The old link went to the wrong inbox: a new version kills it.
        token_version: target.token_version + 1,
        token_expires_at: expires,
        invite_sent_at: null,
        invite_email_id: null,
        invite_error: null,
        invite_attempts: 0,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', target.id)
    if (error) throw new Error(`Correcting the signer failed: ${error.message}`)

    // The document prints signers' emails. While nobody has signed, it can
    // show the corrected one; after a signature, the text someone signed
    // stays as it was and the audit trail carries the change.
    const anySigned = recipients.some((r) => r.status === 'completed' || r.signed_at)
    let prefillUpdated = false
    if (!anySigned && env.prefill) {
      const prefill = { ...env.prefill }
      for (const key of EMAIL_PREFILL[roleOf(target)]) {
        if (prefill[key] && prefill[key].toLowerCase() === target.email.toLowerCase()) {
          prefill[key] = email
          prefillUpdated = true
        }
      }
      if (prefillUpdated) await db.from('agreements').update({ prefill }).eq('id', env.id)
    }

    await appendAudit(db, {
      envelopeRow: env.id,
      recipientRow: target.id,
      event: 'corrected',
      detail: {
        from: target.email,
        to: email,
        ...(name !== target.name ? { nameFrom: target.name, nameTo: name } : {}),
        prefillUpdated,
      },
    })

    const updated = { ...target, email, name, status, token_version: target.token_version + 1, token_expires_at: expires, invite_sent_at: null }
    if (due) await sendInvites(db, [updated])
    return toRecipient(updated)
  },

  async getFieldValues({ db }, externalId) {
    const env = await loadEnvelopeByExternalId(db, externalId)
    if (!env) return []
    const fields: { name: string; value: string }[] = []
    for (const r of await loadRecipients(db, env.id)) {
      for (const [name, value] of Object.entries(r.signer_values ?? {})) fields.push({ name, value })
    }
    return fields
  },

  async getSignedDocument({ db }, externalId, opts) {
    const { data: row } = await db
      .from('agreements')
      .select('signed_pdf_path, certificate_path')
      .eq('envelope_id', externalId)
      .eq('provider', 'native')
      .maybeSingle()
    const pdfPath = (row as { signed_pdf_path?: string | null } | null)?.signed_pdf_path
    if (!pdfPath) throw new Error('This agreement has not been completed')
    const read = async (path: string) => {
      const { data, error } = await db.storage.from(SIGNED_BUCKET).download(path)
      if (error || !data) throw new Error(`Stored record ${path} could not be read`)
      return data.arrayBuffer()
    }
    const certPath = (row as { certificate_path?: string | null }).certificate_path
    return {
      pdf: await read(pdfPath),
      certificate: opts?.certificate && certPath ? await read(certPath) : null,
    }
  },
}
