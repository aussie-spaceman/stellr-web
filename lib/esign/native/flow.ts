import type { SupabaseClient } from '@supabase/supabase-js'
import { appendAudit, appendAuditQuietly, loadAudit } from '@/lib/esign/native/audit'
import { ROLE_NAME, type IssuePlan, type TemplateKey } from '@/lib/esign/native/plan'
import { renderExecuted, renderPreview, type SignerRender } from '@/lib/esign/native/render'
import { initialValues, signerFields, validateSignerValues, type Role } from '@/lib/esign/native/template'
import { loadTemplateById, loadTemplatePdf, type TemplateVersion } from '@/lib/esign/native/templates-store'
import {
  SESSION_TTL_SECONDS,
  SIGN_LINK_TTL_SECONDS,
  mintToken,
  verifyToken,
} from '@/lib/esign/native/tokens'
import { archivePaths, putImmutable, retainUntilOnCompletion, sha256Hex, SIGNED_BUCKET } from '@/lib/esign/storage'

// Stellr signing, from issue to sealed record. Each signer moves through:
//
//   created  — waiting for an earlier signer (a minor's guardian signs first)
//   sent     — their turn; the signing email is queued or sent
//   delivered— they opened the link
//   completed| declined
//
// The agreement completes when every signer has signed: the engine applies
// Stellr's counter-signature where the document has one, renders the executed
// PDF with its certificate page, stores it, and only then marks it completed.

export { DISCLOSURE_VERSION } from '@/lib/esign/disclosure'

/** Wrong year-of-birth answers before a link is locked and has to be re-sent. */
export const MAX_FAILED_CHECKS = 5

const NATIVE_ENVELOPE_COLUMNS =
  'id, envelope_id, provider, status, envelope_type, member_id, participant_id, event_title, ' +
  'minor_name, signer_name, template_id, prefill, sent_at, completed_at, sealed_at, reused_from, ' +
  'credential_sharing_opt_out, archived_at, archive_attempts'

const RECIPIENT_COLUMNS =
  'id, envelope_row, recipient_id, role_name, name, email, status, routing_order, member_id, ' +
  'delivered_at, signed_at, declined_at, token_version, token_expires_at, failed_token_attempts, ' +
  'viewed_at, consented_at, disclosure_version, attested_at, signed_ip, signed_user_agent, ' +
  'signature_kind, signature_text, signature_image_path, signer_values, invite_sent_at'

export interface NativeEnvelope {
  id: string
  envelope_id: string
  provider: string
  status: string
  envelope_type: string
  member_id: string | null
  participant_id: string | null
  event_title: string | null
  minor_name: string | null
  signer_name: string | null
  template_id: string | null
  prefill: Record<string, string> | null
  sent_at: string | null
  completed_at: string | null
  sealed_at: string | null
  reused_from: string | null
  credential_sharing_opt_out: boolean | null
  archived_at: string | null
  archive_attempts: number | null
}

export interface NativeRecipient {
  id: string
  envelope_row: string
  recipient_id: string
  role_name: string
  name: string
  email: string
  status: string
  routing_order: number
  member_id: string | null
  delivered_at: string | null
  signed_at: string | null
  declined_at: string | null
  token_version: number
  token_expires_at: string | null
  failed_token_attempts: number
  viewed_at: string | null
  consented_at: string | null
  disclosure_version: string | null
  attested_at: string | null
  signed_ip: string | null
  signed_user_agent: string | null
  signature_kind: string | null
  signature_text: string | null
  /** A drawn signature's PNG, in the signed-agreements bucket. */
  signature_image_path?: string | null
  signer_values: Record<string, string> | null
  invite_sent_at: string | null
}

const ROLE_FROM_NAME: Record<string, Role> = Object.fromEntries(
  (Object.entries(ROLE_NAME) as [Role, string][]).map(([role, name]) => [name, role]),
) as Record<string, Role>

export function roleOf(r: { role_name: string }): Role {
  const role = ROLE_FROM_NAME[r.role_name]
  if (!role) throw new Error(`Unknown signer role ${r.role_name}`)
  return role
}

const ROLE_LABEL: Record<Role, string> = {
  guardian: 'Parent or legal guardian',
  student: 'Student',
  adult: 'Participant',
  mentor: 'Mentor',
  member: 'Member',
  stellr: 'Stellr Education',
}

const LIVE_ENVELOPE = new Set(['sent', 'delivered'])
const ACTIVE_RECIPIENT = new Set(['sent', 'delivered'])

// ── Loading ──────────────────────────────────────────────────────────────────

export async function loadEnvelope(db: SupabaseClient, envelopeRowId: string): Promise<NativeEnvelope | null> {
  const { data } = await db.from('agreements').select(NATIVE_ENVELOPE_COLUMNS).eq('id', envelopeRowId).eq('provider', 'native').maybeSingle()
  return (data as unknown as NativeEnvelope | null) ?? null
}

export async function loadEnvelopeByExternalId(db: SupabaseClient, externalId: string): Promise<NativeEnvelope | null> {
  const { data } = await db.from('agreements').select(NATIVE_ENVELOPE_COLUMNS).eq('envelope_id', externalId).eq('provider', 'native').maybeSingle()
  return (data as unknown as NativeEnvelope | null) ?? null
}

export async function loadRecipients(db: SupabaseClient, envelopeRowId: string): Promise<NativeRecipient[]> {
  const { data, error } = await db
    .from('agreement_recipients')
    .select(RECIPIENT_COLUMNS)
    .eq('envelope_row', envelopeRowId)
    .order('routing_order', { ascending: true })
  if (error) throw new Error(`Signer lookup failed: ${error.message}`)
  return (data ?? []) as unknown as NativeRecipient[]
}

async function loadRecipient(db: SupabaseClient, recipientId: string): Promise<NativeRecipient | null> {
  const { data } = await db.from('agreement_recipients').select(RECIPIENT_COLUMNS).eq('id', recipientId).maybeSingle()
  return (data as unknown as NativeRecipient | null) ?? null
}

// ── Issue ────────────────────────────────────────────────────────────────────

/**
 * Creates the signer rows for a newly recorded agreement and records the issue
 * in the audit trail. The first signers in the order become active; later ones
 * wait. Returns the active signers.
 */
export async function insertSigners(
  db: SupabaseClient,
  envelopeRowId: string,
  plan: IssuePlan,
  template: TemplateVersion,
  now = new Date(),
): Promise<NativeRecipient[]> {
  const first = Math.min(...plan.signers.map((s) => s.order))
  const expires = new Date(now.getTime() + SIGN_LINK_TTL_SECONDS * 1000).toISOString()
  const rows = plan.signers.map((s, i) => ({
    envelope_row: envelopeRowId,
    recipient_id: String(i + 1),
    role_name: ROLE_NAME[s.role],
    name: s.name,
    email: s.email,
    member_id: s.memberId,
    routing_order: s.order,
    status: s.order === first ? 'sent' : 'created',
    token_version: 1,
    token_expires_at: s.order === first ? expires : null,
    last_synced_at: now.toISOString(),
  }))
  const { data, error } = await db.from('agreement_recipients').insert(rows).select(RECIPIENT_COLUMNS)
  if (error) throw new Error(`Recording the signers failed: ${error.message}`)

  await appendAudit(db, {
    envelopeRow: envelopeRowId,
    event: 'issued',
    detail: {
      template: { key: template.key, version: template.version, sha256: template.pdfSha256 },
      signers: plan.signers.map((s) => ({ role: s.role, order: s.order })),
      prefillKeys: Object.keys(plan.prefill).sort(),
    },
  })
  return ((data ?? []) as unknown as NativeRecipient[]).filter((r) => r.status === 'sent')
}

/**
 * Activates the next signers once everyone before them has signed. Returns the
 * signers activated, for the caller to email.
 */
export async function activateNext(db: SupabaseClient, envelopeRowId: string, now = new Date()): Promise<NativeRecipient[]> {
  const recipients = await loadRecipients(db, envelopeRowId)
  const waiting = recipients.filter((r) => r.status === 'created')
  if (!waiting.length) return []
  const next = Math.min(...waiting.map((r) => r.routing_order))
  const blocked = recipients.some((r) => r.routing_order < next && r.status !== 'completed')
  if (blocked) return []

  const expires = new Date(now.getTime() + SIGN_LINK_TTL_SECONDS * 1000).toISOString()
  const { data, error } = await db
    .from('agreement_recipients')
    .update({ status: 'sent', token_expires_at: expires, last_synced_at: now.toISOString() })
    .eq('envelope_row', envelopeRowId)
    .eq('routing_order', next)
    .eq('status', 'created')
    .select(RECIPIENT_COLUMNS)
  if (error) throw new Error(`Activating the next signer failed: ${error.message}`)
  return (data ?? []) as unknown as NativeRecipient[]
}

// ── Opening a link ───────────────────────────────────────────────────────────

export type LinkState =
  | { kind: 'invalid' }
  | { kind: 'verify'; question: 'birth_year'; documentLabel: string; aboutSigner: boolean }
  | { kind: 'not_yet' }
  | { kind: 'already_signed'; completed: boolean }
  | { kind: 'ready'; recipient: NativeRecipient; envelope: NativeEnvelope; session: string; sessionExpires: Date }

function subjectBirthYear(env: NativeEnvelope): string | null {
  return env.prefill?.SubjectBirthYear || null
}

function documentLabelFor(env: NativeEnvelope): string {
  return env.envelope_type === 'minor' ? 'consent form' : env.envelope_type === 'membership' ? 'membership agreement' : 'agreement'
}

/**
 * What a signing link leads to. Every refusal looks the same to the person
 * holding the link, so a stray or guessed link learns nothing about whose
 * agreement it was.
 */
export async function openLink(
  db: SupabaseClient,
  token: string,
  opts: { birthYear?: string | null; now?: Date } = {},
): Promise<LinkState> {
  const now = opts.now ?? new Date()
  const verified = verifyToken(token, 'sign', now.getTime())
  if (!verified) return { kind: 'invalid' }

  const recipient = await loadRecipient(db, verified.recipientId)
  if (!recipient) return { kind: 'invalid' }
  const envelope = await loadEnvelope(db, recipient.envelope_row)
  if (!envelope) return { kind: 'invalid' }

  // Signing retires the link (its version moves on), but a genuine link that
  // has done its job says so rather than looking broken. It reveals nothing
  // beyond "signed".
  if (recipient.status === 'completed') return { kind: 'already_signed', completed: envelope.status === 'completed' }
  if (recipient.token_version !== verified.version) return { kind: 'invalid' }
  if (!LIVE_ENVELOPE.has(envelope.status) || recipient.status === 'declined') return { kind: 'invalid' }
  if (recipient.token_expires_at && new Date(recipient.token_expires_at) <= now) return { kind: 'invalid' }
  const failedChecks = recipient.failed_token_attempts ?? 0
  if (failedChecks >= MAX_FAILED_CHECKS) return { kind: 'invalid' }
  if (recipient.status === 'created') return { kind: 'not_yet' }

  // A child's details sit in this document. The address it was sent to was
  // typed by whoever registered, sometimes wrongly; the year of birth stops a
  // stranger who received it by mistake from reading on.
  const expectedYear = subjectBirthYear(envelope)
  if (expectedYear) {
    // The student (or young member) is asked about themselves, a parent about their child.
    const verify = {
      kind: 'verify', question: 'birth_year', documentLabel: documentLabelFor(envelope),
      aboutSigner: roleOf(recipient) === 'student' || roleOf(recipient) === 'member',
    } as const
    const answer = (opts.birthYear ?? '').trim()
    if (!answer) return verify
    if (answer !== expectedYear) {
      await db
        .from('agreement_recipients')
        .update({ failed_token_attempts: failedChecks + 1 })
        .eq('id', recipient.id)
      if (failedChecks + 1 >= MAX_FAILED_CHECKS) return { kind: 'invalid' }
      return verify
    }
  }

  const { token: session, expiresAt } = mintToken(recipient.id, 'session', recipient.token_version, SESSION_TTL_SECONDS, now.getTime())
  return { kind: 'ready', recipient, envelope, session, sessionExpires: expiresAt }
}

export interface SessionContext {
  recipient: NativeRecipient
  envelope: NativeEnvelope
}

/**
 * Resolves the signing session cookie. `act` requires the signer still to be
 * able to sign; `read` also accepts a signer who has finished (to download
 * their copy straight after signing).
 */
export async function resolveSession(
  db: SupabaseClient,
  cookie: string | undefined,
  mode: 'act' | 'read',
  now = new Date(),
): Promise<SessionContext | null> {
  if (!cookie) return null
  const verified = verifyToken(cookie, 'session', now.getTime())
  if (!verified) return null
  const recipient = await loadRecipient(db, verified.recipientId)
  if (!recipient) return null
  const envelope = await loadEnvelope(db, recipient.envelope_row)
  if (!envelope) return null

  if (mode === 'act') {
    if (recipient.token_version !== verified.version) return null
    if (!ACTIVE_RECIPIENT.has(recipient.status) || !LIVE_ENVELOPE.has(envelope.status)) return null
  } else {
    // Completion bumps the token version to kill the emailed link; the
    // session that did the signing may still read the outcome.
    if (verified.version > recipient.token_version) return null
    if (envelope.status === 'voided') return null
  }
  return { recipient, envelope }
}

// ── What the signer sees ─────────────────────────────────────────────────────

export interface SigningView {
  documentTitle: string
  eventTitle: string | null
  roleLabel: string
  signerName: string
  disclosureVersion: string
  consented: boolean
  attestation: string | null
  fields: { name: string; label: string; type: string; required: boolean; value: string }[]
  textHtml: string | null
}

export async function signingView(db: SupabaseClient, ctx: SessionContext): Promise<SigningView> {
  const template = await loadTemplateById(db, ctx.envelope.template_id as string)
  const role = roleOf(ctx.recipient)
  const prefill = ctx.envelope.prefill ?? {}
  const initial = initialValues(template.map, role, prefill)
  const fields = signerFields(template.map, role)
    .filter((f) => f.type !== 'signature')
    .map((f) => ({ name: f.name, label: f.label, type: f.type, required: f.required, value: initial[f.name] ?? '' }))

  const studentName = prefill.MinorName || prefill.MemberName || ''
  const attestation = role === 'guardian' && studentName
    ? `I am the parent or legal guardian of ${studentName}, and I am authorised to sign for them.`
    : null

  return {
    documentTitle: template.title,
    eventTitle: ctx.envelope.event_title,
    roleLabel: ROLE_LABEL[role],
    signerName: ctx.recipient.name,
    disclosureVersion: template.disclosureVersion,
    consented: !!ctx.recipient.consented_at && ctx.recipient.disclosure_version === template.disclosureVersion,
    attestation,
    fields,
    textHtml: template.textHtml,
  }
}

/** Drawn signatures, by recipient row, read back from storage. */
async function loadSignatureImages(db: SupabaseClient, recipients: NativeRecipient[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  for (const r of recipients) {
    if (r.status !== 'completed' || r.signature_kind !== 'drawn' || !r.signature_image_path) continue
    const { data, error } = await db.storage.from(SIGNED_BUCKET).download(r.signature_image_path)
    if (error || !data) throw new FinaliseError(`Drawn signature for ${r.id} could not be read`)
    out.set(r.id, new Uint8Array(await data.arrayBuffer()))
  }
  return out
}

function completedSigners(recipients: NativeRecipient[], images: Map<string, Uint8Array> = new Map()): SignerRender[] {
  return recipients
    .filter((r) => r.status === 'completed')
    .map((r) => {
      const png = images.get(r.id)
      return {
        role: roleOf(r),
        name: r.name,
        email: r.email,
        values: r.signer_values ?? {},
        signedAt: r.signed_at ?? undefined,
        signature: png && r.signature_text
          ? { kind: 'drawn' as const, png, text: r.signature_text }
          : r.signature_text ? { kind: 'typed' as const, text: r.signature_text } : undefined,
      }
    })
}

/** The document as it stands for this signer: prefill plus what earlier signers entered. */
export async function previewFor(db: SupabaseClient, ctx: SessionContext): Promise<Uint8Array> {
  const template = await loadTemplateById(db, ctx.envelope.template_id as string)
  const recipients = await loadRecipients(db, ctx.envelope.id)
  return renderPreview({
    template: await loadTemplatePdf(db, template),
    map: template.map,
    prefill: ctx.envelope.prefill ?? {},
    names: namesFor(ctx.envelope, recipients),
    signers: completedSigners(recipients, await loadSignatureImages(db, recipients)),
  })
}

function namesFor(env: NativeEnvelope, recipients: NativeRecipient[]): Partial<Record<Role, string>> {
  const names: Partial<Record<Role, string>> = {}
  for (const r of recipients) names[roleOf(r)] = r.name
  const p = env.prefill ?? {}
  if (p.MinorName) names.student ??= p.MinorName
  if (p.MemberName) names.member ??= p.MemberName
  return names
}

// ── Signing steps ────────────────────────────────────────────────────────────

export interface RequestMeta {
  ip: string | null
  userAgent: string | null
}

export async function recordViewed(db: SupabaseClient, ctx: SessionContext, meta: RequestMeta, now = new Date()): Promise<void> {
  const first = !ctx.recipient.viewed_at
  await db
    .from('agreement_recipients')
    .update({
      viewed_at: ctx.recipient.viewed_at ?? now.toISOString(),
      delivered_at: ctx.recipient.delivered_at ?? now.toISOString(),
      status: ctx.recipient.status === 'sent' ? 'delivered' : ctx.recipient.status,
      last_synced_at: now.toISOString(),
    })
    .eq('id', ctx.recipient.id)
  if (ctx.envelope.status === 'sent') {
    await db.from('agreements').update({ status: 'delivered', updated_at: now.toISOString() }).eq('id', ctx.envelope.id).eq('status', 'sent')
  }
  if (first) {
    await appendAuditQuietly(db, { envelopeRow: ctx.envelope.id, recipientRow: ctx.recipient.id, event: 'viewed', ...auditMeta(meta) })
  }
}

function auditMeta(meta: RequestMeta) {
  return { ip: meta.ip, userAgent: meta.userAgent }
}

export async function recordConsent(
  db: SupabaseClient,
  ctx: SessionContext,
  input: { disclosureVersion: string; attest?: boolean },
  meta: RequestMeta,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const view = await signingView(db, ctx)
  if (input.disclosureVersion !== view.disclosureVersion) {
    return { ok: false, error: 'The disclosure has changed. Reload the page to read the current version.' }
  }
  if (view.attestation && !input.attest) {
    return { ok: false, error: 'Confirm that you are the parent or legal guardian to continue.' }
  }
  await appendAudit(db, {
    envelopeRow: ctx.envelope.id,
    recipientRow: ctx.recipient.id,
    event: 'consented',
    ...auditMeta(meta),
    detail: { disclosureVersion: view.disclosureVersion },
  })
  if (view.attestation) {
    await appendAudit(db, {
      envelopeRow: ctx.envelope.id,
      recipientRow: ctx.recipient.id,
      event: 'attested',
      ...auditMeta(meta),
      detail: { statement: view.attestation },
    })
  }
  await db
    .from('agreement_recipients')
    .update({
      consented_at: now.toISOString(),
      disclosure_version: view.disclosureVersion,
      attested_at: view.attestation ? now.toISOString() : null,
    })
    .eq('id', ctx.recipient.id)
  return { ok: true }
}

export type SubmitResult =
  | { ok: true; agreementComplete: boolean; activated: NativeRecipient[] }
  | { ok: false; status: number; error: string; fieldErrors?: Record<string, string>; nameOnRecord?: string }

/** Case, accents, punctuation and spacing aside, is this the name we sent the link to? */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return norm(a) === norm(b)
}

/**
 * Records the signature. Exactly-once: the signer row moves to completed under
 * a condition on its current status, so a double submission records one
 * signature and the second is refused.
 */
export async function submitSignature(
  db: SupabaseClient,
  ctx: SessionContext,
  input: {
    values: Record<string, unknown>
    signatureText: string
    confirmDifferentName?: boolean
    /** A drawn signature, already checked (./signature-image). The typed name is still required. */
    signaturePng?: Uint8Array | null
  },
  meta: RequestMeta,
  now = new Date(),
): Promise<SubmitResult> {
  const template = await loadTemplateById(db, ctx.envelope.template_id as string)
  const role = roleOf(ctx.recipient)
  if (!ctx.recipient.consented_at || ctx.recipient.disclosure_version !== template.disclosureVersion) {
    return { ok: false, status: 409, error: 'Agree to sign electronically first.' }
  }

  const checked = validateSignerValues(template.map, role, ctx.envelope.prefill ?? {}, input.values)
  if (!checked.ok) return { ok: false, status: 422, error: 'Check the highlighted fields.', fieldErrors: checked.errors }

  const signatureText = input.signatureText.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (signatureText.length < 2 || signatureText.length > 120) {
    return { ok: false, status: 422, error: 'Type your full name to sign.', fieldErrors: { signature: 'Type your full name to sign.' } }
  }
  // A different name is allowed (the name we hold may be misspelled), but only
  // when the signer confirms it, and the record says so.
  const nameMatchesRecord = sameName(signatureText, ctx.recipient.name)
  if (!nameMatchesRecord && !input.confirmDifferentName) {
    return {
      ok: false,
      status: 409,
      error: 'name_differs',
      nameOnRecord: ctx.recipient.name,
      fieldErrors: { signature: `That’s different from the name on this form (${ctx.recipient.name}).` },
    }
  }

  // A drawn signature is stored before the signature is recorded, so a signed
  // row never points at an image that is not there. Named by its hash: a retry
  // with the same drawing finds it, a different drawing never overwrites it.
  let imagePath: string | null = null
  let imageSha: string | null = null
  if (input.signaturePng) {
    imageSha = sha256Hex(input.signaturePng)
    imagePath = `native/${now.getUTCFullYear()}/${ctx.envelope.id}/signature-${ctx.recipient.id}-${imageSha.slice(0, 16)}.png`
    await putImmutable(db, imagePath, input.signaturePng, 'image/png')
  }
  const kind = imagePath ? 'drawn' : 'typed'

  const { data: claimed, error } = await db
    .from('agreement_recipients')
    .update({
      status: 'completed',
      signed_at: now.toISOString(),
      signer_values: checked.values,
      signature_kind: kind,
      signature_text: signatureText,
      signature_image_path: imagePath,
      signed_ip: meta.ip,
      signed_user_agent: meta.userAgent?.slice(0, 400) ?? null,
      token_version: ctx.recipient.token_version + 1,
      last_synced_at: now.toISOString(),
    })
    .eq('id', ctx.recipient.id)
    .in('status', ['sent', 'delivered'])
    .select('id')
  if (error) throw new Error(`Recording the signature failed: ${error.message}`)
  if (!claimed?.length) return { ok: false, status: 409, error: 'This has already been signed.' }

  await appendAudit(db, {
    envelopeRow: ctx.envelope.id,
    recipientRow: ctx.recipient.id,
    event: 'signed',
    ...auditMeta(meta),
    detail: {
      role,
      signatureKind: kind,
      signatureText,
      ...(imageSha ? { signatureImageSha256: imageSha } : {}),
      nameOnRecord: ctx.recipient.name,
      nameMatchesRecord,
      values: checked.values,
      templateSha256: template.pdfSha256,
    },
  })

  const recipients = await loadRecipients(db, ctx.envelope.id)
  await db
    .from('agreements')
    .update({
      signers_completed: recipients.filter((r) => r.status === 'completed').length,
      updated_at: now.toISOString(),
    })
    .eq('id', ctx.envelope.id)

  if (recipients.every((r) => r.status === 'completed')) {
    await finaliseAgreement(db, ctx.envelope.id, now)
    return { ok: true, agreementComplete: true, activated: [] }
  }
  return { ok: true, agreementComplete: false, activated: await activateNext(db, ctx.envelope.id, now) }
}

export async function declineAgreement(
  db: SupabaseClient,
  ctx: SessionContext,
  reason: string,
  meta: RequestMeta,
  now = new Date(),
): Promise<void> {
  const cleanReason = reason.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500)
  const { data: claimed } = await db
    .from('agreement_recipients')
    .update({ status: 'declined', declined_at: now.toISOString(), declined_reason: cleanReason, token_version: ctx.recipient.token_version + 1 })
    .eq('id', ctx.recipient.id)
    .in('status', ['sent', 'delivered'])
    .select('id')
  if (!claimed?.length) return
  await db
    .from('agreements')
    .update({ status: 'declined', declined_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', ctx.envelope.id)
  await appendAudit(db, {
    envelopeRow: ctx.envelope.id,
    recipientRow: ctx.recipient.id,
    event: 'declined',
    ...auditMeta(meta),
    detail: { reason: cleanReason },
  })
}

// ── Completion ───────────────────────────────────────────────────────────────

/**
 * Stellr's standing authorisation to counter-sign mentor and volunteer
 * agreements automatically. All three must be configured: an agreement that
 * needs a counter-signature does not complete without them.
 */
export function countersignConfig(): { name: string; title: string; authority: string } | null {
  const name = process.env.ESIGN_COUNTERSIGN_NAME?.trim()
  const title = process.env.ESIGN_COUNTERSIGN_TITLE?.trim()
  const authority = process.env.ESIGN_COUNTERSIGN_AUTHORITY?.trim()
  return name && title && authority ? { name, title, authority } : null
}

export class FinaliseError extends Error {}

/**
 * Counter-signs where required, renders and stores the executed agreement, and
 * marks it completed. Claimed through sealed_at so it runs once; on failure the
 * claim is released and the reason recorded, and the reconciliation job tries
 * again.
 */
export async function finaliseAgreement(db: SupabaseClient, envelopeRowId: string, now = new Date()): Promise<void> {
  const { data: claim } = await db
    .from('agreements')
    .update({ sealed_at: now.toISOString() })
    .eq('id', envelopeRowId)
    .is('sealed_at', null)
    .in('status', ['sent', 'delivered'])
    .select('id')
  if (!claim?.length) return

  try {
    const envelope = await loadEnvelope(db, envelopeRowId)
    if (!envelope?.template_id) throw new FinaliseError('Agreement has no template')
    const template = await loadTemplateById(db, envelope.template_id)
    const recipients = await loadRecipients(db, envelopeRowId)
    if (!recipients.every((r) => r.status === 'completed')) throw new FinaliseError('Not every signer has signed')

    const signers = completedSigners(recipients, await loadSignatureImages(db, recipients))
    const needsCountersign = template.map.roles.some((r) => r.role === 'stellr')
    let countersignature: { name: string; title: string; authority: string; at: string } | null = null
    if (needsCountersign) {
      const config = countersignConfig()
      if (!config) throw new FinaliseError('Counter-signature is not configured (ESIGN_COUNTERSIGN_NAME, _TITLE, _AUTHORITY)')
      countersignature = { ...config, at: now.toISOString() }
      signers.push({
        role: 'stellr',
        name: config.name,
        email: '',
        values: {},
        title: config.title,
        signedAt: now.toISOString(),
        signature: { kind: 'typed', text: config.name },
      })
      await appendAudit(db, {
        envelopeRow: envelopeRowId,
        event: 'countersigned',
        detail: { name: config.name, title: config.title, authority: config.authority },
      })
    }

    const audit = await loadAudit(db, envelopeRowId)
    const head = audit.at(-1)?.hash ?? null
    const firstConsent = (r: NativeRecipient) => r.consented_at
    const executed = await renderExecuted(
      {
        template: await loadTemplatePdf(db, template),
        map: template.map,
        prefill: envelope.prefill ?? {},
        names: namesFor(envelope, recipients),
        signers,
      },
      {
        agreementId: envelope.id,
        title: `${template.title}${envelope.event_title ? ` — ${envelope.event_title}` : ''}`,
        templateKey: template.key,
        templateVersion: template.version,
        templateSha256: template.pdfSha256,
        disclosureVersion: template.disclosureVersion,
        issuedAt: envelope.sent_at ?? now.toISOString(),
        completedAt: now.toISOString(),
        signers: recipients.map((r) => ({
          role: ROLE_LABEL[roleOf(r)],
          name: r.name,
          email: r.email,
          consentedAt: firstConsent(r),
          signedAt: r.signed_at as string,
          ip: r.signed_ip,
          userAgent: r.signed_user_agent,
          method: r.signature_kind === 'drawn' ? 'drawn signature' : 'typed name',
        })),
        countersignature,
        auditHead: head,
      },
    )

    const auditFile = new TextEncoder().encode(JSON.stringify({
      agreementId: envelope.id,
      template: { key: template.key, version: template.version, sha256: template.pdfSha256 },
      prefill: envelope.prefill,
      signers: recipients.map((r) => ({
        role: roleOf(r), name: r.name, email: r.email, values: r.signer_values,
        signature: { kind: r.signature_kind, text: r.signature_text },
        consentedAt: r.consented_at, disclosureVersion: r.disclosure_version, attestedAt: r.attested_at,
        signedAt: r.signed_at, ip: r.signed_ip, userAgent: r.signed_user_agent,
      })),
      countersignature,
      // Characters the PDF font could not draw: their exact values are here.
      substituted: executed.substituted,
      documentSha256: executed.documentSha256,
      fileSha256: executed.sha256,
      events: audit,
    }, null, 2))

    const paths = archivePaths({ id: envelope.id, provider: 'native', completed_at: now.toISOString() })
    const pdfSha = await putImmutable(db, paths.pdf, executed.bytes, 'application/pdf')
    await putImmutable(db, paths.certificate, auditFile, 'application/json')

    await appendAudit(db, {
      envelopeRow: envelopeRowId,
      event: 'sealed',
      detail: { sha256: pdfSha, documentSha256: executed.documentSha256, sealKind: 'hash', bytes: executed.bytes.byteLength },
    })

    const completedAt = now.toISOString()
    const { error } = await db
      .from('agreements')
      .update({
        status: 'completed',
        completed_at: completedAt,
        signers_completed: recipients.length,
        signed_pdf_path: paths.pdf,
        signed_pdf_sha256: pdfSha,
        signed_pdf_bytes: executed.bytes.byteLength,
        certificate_path: paths.certificate,
        certificate_bytes: auditFile.byteLength,
        archived_at: completedAt,
        seal_kind: 'hash',
        retain_until: retainUntilOnCompletion(completedAt, envelope.member_id),
        issue_error: null,
        updated_at: completedAt,
      })
      .eq('id', envelopeRowId)
    if (error) throw new Error(`Marking the agreement completed failed: ${error.message}`)

    await appendAudit(db, { envelopeRow: envelopeRowId, event: 'completed' })

    // The certificate seal, before anyone is sent their copy. Not fatal: the
    // hash seal above already stands, and the daily run seals it later.
    try {
      const { applyCertificateSeal } = await import('@/lib/esign/native/certificate-seal')
      await applyCertificateSeal(db, envelopeRowId, now)
    } catch (sealErr) {
      console.error(`[esign-flow] certificate seal for ${envelopeRowId} deferred:`, sealErr instanceof Error ? sealErr.message : sealErr)
    }

    const { onEnvelopeCompleted, COMPLETED_ENVELOPE_COLUMNS } = await import('@/lib/esign/completion')
    const { data: done } = await db.from('agreements').select(COMPLETED_ENVELOPE_COLUMNS).eq('id', envelopeRowId).maybeSingle()
    if (done) await onEnvelopeCompleted(db, done as never)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[esign-flow] finalising ${envelopeRowId} failed:`, message)
    await db
      .from('agreements')
      .update({ sealed_at: null, issue_error: `Completion failed: ${message}`.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', envelopeRowId)
    if (err instanceof FinaliseError) return
    throw err
  }
}

/** Agreements every signer has signed but that never finished completing. Retried daily. */
export async function finaliseStalled(db: SupabaseClient, limit = 10): Promise<{ retried: number }> {
  const { data } = await db
    .from('agreements')
    .select('id, signers_total, signers_completed')
    .eq('provider', 'native')
    .in('status', ['sent', 'delivered'])
    .is('sealed_at', null)
    .limit(200)
  const stalled = ((data ?? []) as { id: string; signers_total: number | null; signers_completed: number | null }[])
    .filter((r) => (r.signers_total ?? 0) > 0 && r.signers_completed === r.signers_total)
    .slice(0, limit)
  for (const row of stalled) await finaliseAgreement(db, row.id)
  return { retried: stalled.length }
}

export type { TemplateKey }
