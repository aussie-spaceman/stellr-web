import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { normalizeEmail } from '@/lib/member-enums'
import { GUARDIAN_RELATIONSHIPS, isPlausibleEmail } from '@/lib/pending-consent'
import { auditMutation } from '@/lib/audit/route'
import { HOUR_MS } from '@/lib/rate-limit'
import { limit as limitRequests } from '@/lib/rate-limit-async'
import type { AuditAction } from '@/lib/audit/actions'
import { isTenantRow, loadTenantSender } from '@/lib/event-emails/tenant-mail'
import {
  issueTenantGuardianConsent,
  tenantGuardianConsentDocumentReady,
  TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE,
} from '@/lib/esign/tenant-guardian-consent'
import { tenantGuardianConsentEnabled } from './eligibility'
import { sendTenantRegistrationConfirmation, type TenantConfirmationKind } from './tenant-confirmation'

// Guardian consent on another organiser's event (S5 wave 6, owner decision
// 10 Nov 2026): a registrant aged 14 to 17 on the event day may register for a
// tenant's event once a parent or legal guardian signs. Behind
// TENANT_GUARDIAN_CONSENT_ENABLED (lib/registration/eligibility.ts), off by
// default; with it off every minor is refused at a tenant event, as before.
//
// The flow, for register/individual:
//
//   1. The gate admits a 14-17-year-old only with a parent's or legal guardian's
//      name and email (the form's emergency contact, with relationship Parent or
//      Legal Guardian) and only when the flow can run for this event: the flag is
//      on, signing is configured, the platform-locked consent document is
//      published, the tenant has a sender, and the event has not started. If any
//      is missing, the minor gets the approved refusal and nothing is written.
//   2. The registration and participant are saved as for an adult. The
//      participant insert itself writes a pending tenant_guardian_consents row (a
//      database trigger, so no writer can leave a tenant-event minor without one);
//      the route sets its window and records the consent envelope
//      (lib/esign/tenant-guardian-consent.ts). If either fails, the registration is
//      taken back; if the take-back fails too, the participant stays pending and
//      the sweep removes it when the window closes.
//   3. The guardian's invitation goes through B14's checked call
//      (lib/event-emails/tenant-signing.ts), from the tenant's sender. The
//      registrant is told their place waits on the guardian; they get no
//      "registered" confirmation yet.
//   4. A guardian's signature completes the envelope; lib/esign/completion.ts
//      calls settleTenantGuardianConsentSigned, which marks the consent signed and
//      sends the registrant their confirmation.
//   5. A decline (lib/esign/native/flow.ts) or the window closing (the daily sweep,
//      run from the membership-expiry cron) marks the consent declined or expired.
//      The registration is then removed through the deletion registry
//      (pending_guardian_consent_registration: no archive), and the registrant is
//      told.
//
// While pending, the participant cannot be checked in (a database trigger, and the
// check-in route's answer), and tenant event emails leave them out
// (lib/event-emails/audiences.ts). Individual registrations have no capacity count.
//
// Reused from Stellr's own member consent (lib/pending-consent.ts, S1): the
// guardian relationships and the email check. Not reused: its pending row and purge
// (they are about a member account, and a tenant registration links no member), and
// its consent document (Stellr's own V2.3 agreement, sent as Stellr).
//
// Guardian contact data stays where the form put it, on the participant's
// emergency-contact columns (field-encrypted in shadow mode, S4), and on the
// signing envelope. The consent row holds none, and audit events and logs carry
// ids and outcomes only.

/** Days a guardian has to sign, unless the event starts sooner. A proposal for the owner. */
export const TENANT_GUARDIAN_CONSENT_WINDOW_DAYS = 14

/** How long a failed removal waits before the sweep tries again. Under a day, so the next daily run takes it. */
export const REMOVAL_RETRY_MS = 20 * 60 * 60 * 1000

/** Rows per sweep run, so it fits beside the cron's other work. */
export const SWEEP_BATCH = 25

/** The 400 when a 14-17-year-old's form names no usable parent or guardian. A proposal for the owner. */
export const GUARDIAN_REQUIRED_MESSAGE =
  "Because you're under 18, please give a parent's or legal guardian's name and email as your emergency contact, with their relationship to you. We'll email them a consent form, and your place is confirmed once they sign."

export interface GuardianContact {
  firstName: string
  lastName: string
  email: string
  relationship: string
}

/** The form fields a guardian is read from: the emergency contact. */
export interface GuardianFields {
  emergency_contact_first_name?: string | null
  emergency_contact_last_name?: string | null
  emergency_contact_email?: string | null
  emergency_contact_relationship?: string | null
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * The parent or legal guardian named on the form, or null when there is none the
 * consent can go to: a name, a plausible email that is none of the registrant's
 * own addresses (their email and, when given, their school email), and a
 * relationship of Parent or Legal Guardian.
 */
export function guardianFromForm(
  body: GuardianFields,
  registrantEmail: string,
  otherRegistrantEmails: ReadonlyArray<string | null | undefined> = [],
): GuardianContact | null {
  const firstName = text(body.emergency_contact_first_name)
  const lastName = text(body.emergency_contact_last_name)
  const email = normalizeEmail(text(body.emergency_contact_email))
  const relationship = text(body.emergency_contact_relationship)
  if (!firstName || !lastName || !email || !isPlausibleEmail(email)) return null
  const own = [registrantEmail, ...otherRegistrantEmails].map((e) => normalizeEmail(text(e))).filter(Boolean)
  if (own.includes(email)) return null
  if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)) return null
  return { firstName, lastName, email, relationship }
}

/** Consent invitations one guardian address may be sent in a day, across every organiser. A proposal for the owner. */
export const GUARDIAN_INVITES_PER_ADDRESS_PER_DAY = 5

/** Consent invitations one organiser's events may send in an hour. A proposal for the owner. */
export const GUARDIAN_INVITES_PER_TENANT_PER_HOUR = 30

/** The 429 when a cap below is reached. A proposal for the owner. */
export const GUARDIAN_CONSENT_BUSY_MESSAGE =
  "We can't send another consent form just now. Please try again later, or contact the event organiser."

/**
 * Caps the consent invitations an unauthenticated form can direct, before anything
 * is written: per guardian address, across every organiser, so one address cannot
 * be sent forms in many organisers' names; and per organiser, so one organiser's
 * events cannot spend the shared daily email pool (lib/email-budget.ts). The
 * register route's per-IP cap still applies first. lib/rate-limit-async hashes each
 * key before it leaves the process. Returns a ready 429, or null to go on.
 */
export async function consentInvitationRefusal(tenantId: string, guardianEmail: string): Promise<Response | null> {
  const busy = (retryAfterSeconds: number) => {
    console.warn('[tenant-guardian-consent] invitation cap reached for tenant', tenantId)
    return NextResponse.json(
      { code: 'guardian_consent_busy', error: GUARDIAN_CONSENT_BUSY_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }
  const perAddress = await limitRequests(`tenant-guardian-consent:address:${normalizeEmail(guardianEmail)}`, {
    limit: GUARDIAN_INVITES_PER_ADDRESS_PER_DAY,
    windowMs: 24 * HOUR_MS,
    // Not scoped to the tenant: the count is the address's, whoever's event it is.
    tenantId: null,
  })
  if (!perAddress.ok) return busy(perAddress.retryAfterSeconds)
  const perTenant = await limitRequests('tenant-guardian-consent:invitations', {
    limit: GUARDIAN_INVITES_PER_TENANT_PER_HOUR,
    windowMs: HOUR_MS,
    tenantId,
  })
  if (!perTenant.ok) return busy(perTenant.retryAfterSeconds)
  return null
}

export function guardianRequired(): Response {
  return NextResponse.json({ code: 'guardian_required', error: GUARDIAN_REQUIRED_MESSAGE }, { status: 400 })
}

/**
 * When the guardian's window closes: TENANT_GUARDIAN_CONSENT_WINDOW_DAYS from now,
 * or the event's start, whichever is sooner. Null when the event has already
 * started, so no consent can arrive in time.
 */
export function consentWindowEnd(now: Date, eventStartsAt: string | null | undefined): Date | null {
  const end = new Date(now.getTime() + TENANT_GUARDIAN_CONSENT_WINDOW_DAYS * 86_400_000)
  if (!eventStartsAt) return end
  const start = new Date(eventStartsAt)
  if (Number.isNaN(start.getTime())) return null
  if (start.getTime() <= now.getTime()) return null
  return start < end ? start : end
}

export type ConsentReadiness = { ready: true; organiserName: string } | { ready: false; reason: string }

/**
 * Whether the flow can run for this tenant: the flag, signing and the published
 * consent document, the tenant's sender (which also needs
 * TENANT_EVENT_MAIL_ENABLED) and its display name. Never throws: a failed read
 * is "not ready", so the minor is refused rather than left waiting on an
 * invitation that cannot go.
 */
export async function tenantGuardianConsentReadiness(db: SupabaseClient, tenantId: string): Promise<ConsentReadiness> {
  if (!tenantGuardianConsentEnabled()) return { ready: false, reason: 'disabled' }
  if (!isTenantRow(tenantId)) return { ready: false, reason: 'stellr' }
  if (!(await tenantGuardianConsentDocumentReady(db))) return { ready: false, reason: 'document' }
  if (!(await loadTenantSender(db, tenantId))) return { ready: false, reason: 'sender' }
  try {
    const { data, error } = await db.from('tenants').select('display_name').eq('id', tenantId).maybeSingle()
    if (error) throw new Error(error.message)
    const organiserName = text((data as { display_name?: string | null } | null)?.display_name)
    return organiserName ? { ready: true, organiserName } : { ready: false, reason: 'organiser' }
  } catch (err) {
    console.error(`[tenant-guardian-consent] tenant read failed for ${tenantId}:`, err instanceof Error ? err.message : err)
    return { ready: false, reason: 'organiser' }
  }
}

export interface OpenConsentInput {
  tenantId: string
  registrationId: string
  participantId: string
  eventSlug: string
  eventTitle: string
  organiserName: string
  expiresAt: Date
  minorFirstName: string
  minorLastName: string
  minorDateOfBirth: string
  guardian: GuardianContact
}

/**
 * Marks the participant consent-pending and records the consent envelope. Sends
 * nothing. Throws when either write fails; the caller takes the registration back,
 * which cascades the consent row (the envelope cleans up after itself).
 */
export async function openTenantGuardianConsent(
  db: SupabaseClient,
  input: OpenConsentInput,
): Promise<{ consentId: string; agreementId: string }> {
  // The participant insert already wrote this row, pending (the trigger
  // zzz_participants_open_tenant_guardian_consent), so a participant never exists
  // without it. This sets the window the gate settled. A fresh participant's row is
  // always pending, so the upsert overwrites no answer.
  const { data, error } = await db
    .from('tenant_guardian_consents')
    .upsert(
      {
        tenant_id: input.tenantId,
        registration_id: input.registrationId,
        participant_id: input.participantId,
        status: 'pending',
        settled_at: null,
        expires_at: input.expiresAt.toISOString(),
      },
      { onConflict: 'participant_id' },
    )
    .select('id')
    .single()
  if (error || !data) throw new Error(`Recording the consent request failed: ${error?.message ?? 'no row'}`)
  const consentId = (data as { id: string }).id

  const { agreementId } = await issueTenantGuardianConsent(db, {
    tenantId: input.tenantId,
    participantId: input.participantId,
    eventSlug: input.eventSlug,
    eventTitle: input.eventTitle,
    organiserName: input.organiserName,
    minorFirstName: input.minorFirstName,
    minorLastName: input.minorLastName,
    minorDateOfBirth: input.minorDateOfBirth,
    guardianFirstName: input.guardian.firstName,
    guardianLastName: input.guardian.lastName,
    guardianEmail: input.guardian.email,
    relationship: input.guardian.relationship,
  })
  // Informative only: every later step finds the envelope by participant.
  const { error: linkError } = await db.from('tenant_guardian_consents').update({ agreement_id: agreementId }).eq('id', consentId)
  if (linkError) console.error('[tenant-guardian-consent] could not link envelope to consent', consentId, linkError.message)
  return { consentId, agreementId }
}

// ── Audit ───────────────────────────────────────────────────────────────────

interface ConsentRow {
  id: string
  tenant_id: string
  registration_id: string
  participant_id: string
  status: string
  removal_attempts?: number | null
}

const CONSENT_COLUMNS = 'id, tenant_id, registration_id, participant_id, status, removal_attempts'

/**
 * One platform audit event per step (C7), off unless PLATFORM_AUDIT_ENABLED=true.
 * On Stellr's chain, as the register routes' events are, until the owner decides
 * which chain a tenant event's registration rows go on (docs/TENANCY-S5.md, B16).
 * Ids and outcomes only: never a name, an email or a date of birth.
 */
export async function recordConsentAudit(
  action: Extract<AuditAction, `registration.guardian_consent.${string}`>,
  row: { id: string; tenant_id: string },
  metadata: Record<string, unknown> = {},
  opts: { afterResponse?: boolean; db?: SupabaseClient } = {},
): Promise<void> {
  await auditMutation(
    {
      action,
      actor: { system: true },
      tenant: { stellr: true },
      target: { table: 'tenant_guardian_consents', id: row.id },
      metadata: { event_tenant_id: row.tenant_id, ...metadata },
    },
    { afterResponse: opts.afterResponse ?? false, ...(opts.db ? { db: opts.db as never } : {}) },
  )
}

// ── Notices to the registrant ───────────────────────────────────────────────

/**
 * Tells the registrant, at the address on their participant row, from the tenant's
 * sender. Reads the row first, so call it before the row is removed. Never throws.
 */
async function noticeFor(db: SupabaseClient, participantId: string): Promise<{ to: string; firstName: string; eventTitle: string } | null> {
  const { data, error } = await db
    .from('participants')
    .select('email, first_name, registrations(event_title)')
    .eq('id', participantId)
    .maybeSingle()
  if (error || !data) return null
  const p = data as { email: string | null; first_name: string | null; registrations: { event_title?: string | null } | { event_title?: string | null }[] | null }
  const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
  return p.email ? { to: p.email, firstName: p.first_name ?? '', eventTitle: reg?.event_title ?? '' } : null
}

async function sendNotice(
  db: SupabaseClient,
  tenantId: string,
  kind: TenantConfirmationKind,
  notice: { to: string; firstName: string; eventTitle: string } | null,
): Promise<boolean> {
  if (!notice) return false
  const outcome = await sendTenantRegistrationConfirmation(db, { tenantId, kind, ...notice })
  return outcome.ok
}

/**
 * The registrant's "waiting for your guardian" notice, after a pending registration
 * is saved. It says the guardian was emailed only when the invitation went (or waits
 * in the signing outbox); otherwise it says the form is still to come.
 */
export async function sendConsentPendingNotice(
  db: SupabaseClient,
  input: { tenantId: string; to: string; firstName: string; eventTitle: string; invitationSent: boolean },
): Promise<boolean> {
  return sendNotice(db, input.tenantId, input.invitationSent ? 'consent_pending' : 'consent_pending_unsent', {
    to: input.to,
    firstName: input.firstName,
    eventTitle: input.eventTitle,
  })
}

// ── Settling ────────────────────────────────────────────────────────────────

export interface ConsentEnvelope {
  id: string
  envelope_type?: string | null
  participant_id: string | null
  tenant_id?: string | null
}

const isConsentEnvelope = (e: ConsentEnvelope) =>
  (e.envelope_type ?? '') === TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE && !!e.participant_id && isTenantRow(e.tenant_id)

/**
 * The guardian signed: the participant is registered. Called when the consent
 * envelope completes (lib/esign/completion.ts), and by the sweep as a backstop for
 * a missed completion. Idempotent: only a pending consent moves, so a replay sends
 * nothing twice. Returns true when this call settled it.
 */
export async function settleTenantGuardianConsentSigned(db: SupabaseClient, envelope: ConsentEnvelope, now = new Date()): Promise<boolean> {
  if (!isConsentEnvelope(envelope)) return false
  const { data, error } = await db
    .from('tenant_guardian_consents')
    .update({ status: 'signed', settled_at: now.toISOString() })
    .eq('participant_id', envelope.participant_id as string)
    .eq('status', 'pending')
    .select(CONSENT_COLUMNS)
  if (error) throw new Error(`Settling the consent failed: ${error.message}`)
  const row = ((data ?? []) as ConsentRow[])[0]
  if (!row) return false
  await recordConsentAudit('registration.guardian_consent.sign', row, { envelope_id: envelope.id }, { db })
  await sendNotice(db, row.tenant_id, 'consent_signed', await noticeFor(db, row.participant_id))
  return true
}

/**
 * The guardian declined: the consent is marked declined and the registration is
 * removed. Called from the decline (lib/esign/native/flow.ts). A removal that fails
 * is left for the sweep. Never throws.
 */
export async function settleTenantGuardianConsentDeclined(
  db: SupabaseClient,
  envelope: ConsentEnvelope,
  opts: RemovalOptions & { now?: Date } = {},
): Promise<void> {
  try {
    if (!isConsentEnvelope(envelope)) return
    const now = opts.now ?? new Date()
    const { data, error } = await db
      .from('tenant_guardian_consents')
      .update({ status: 'declined', settled_at: now.toISOString() })
      .eq('participant_id', envelope.participant_id as string)
      .eq('status', 'pending')
      .select(CONSENT_COLUMNS)
    if (error) throw new Error(error.message)
    const row = ((data ?? []) as ConsentRow[])[0]
    if (!row) return
    await recordConsentAudit('registration.guardian_consent.decline', row, { envelope_id: envelope.id }, { db })
    await removeUnconsentedRegistration(db, row, 'declined', { ...opts, now })
  } catch (err) {
    console.error('[tenant-guardian-consent] decline not settled:', err instanceof Error ? err.message : err)
  }
}

export interface RemovalOptions {
  /** The deletion registry call, replaceable in tests. */
  deleteRegistration?: (registrationId: string) => Promise<void>
  now?: Date
}

async function registryDelete(registrationId: string): Promise<void> {
  const { executeDeletion } = await import('@/lib/deletion/execute')
  await executeDeletion('pending_guardian_consent_registration', registrationId, { mode: 'hard', deletedBy: null })
}

/**
 * Removes a declined or expired consent's registration through the deletion
 * registry, then tells the registrant. The notice is read first and sent only once
 * the rows are gone, so a failed removal tells nobody and is retried later.
 */
async function removeUnconsentedRegistration(
  db: SupabaseClient,
  row: ConsentRow,
  reason: 'declined' | 'expired',
  opts: RemovalOptions = {},
): Promise<'removed' | 'retry'> {
  const now = opts.now ?? new Date()
  const notice = await noticeFor(db, row.participant_id)
  try {
    await (opts.deleteRegistration ?? registryDelete)(row.registration_id)
  } catch (err) {
    console.error(`[tenant-guardian-consent] removal of registration ${row.registration_id} failed:`, err instanceof Error ? err.message : err)
    await db
      .from('tenant_guardian_consents')
      .update({ removal_attempts: (row.removal_attempts ?? 0) + 1, next_attempt_at: new Date(now.getTime() + REMOVAL_RETRY_MS).toISOString() })
      .eq('id', row.id)
    return 'retry'
  }
  await sendNotice(db, row.tenant_id, reason === 'declined' ? 'consent_declined' : 'consent_expired', notice)
  return 'removed'
}

// ── The daily sweep ─────────────────────────────────────────────────────────

export interface ConsentSweepResult {
  scanned: number
  signed: string[]
  expired: string[]
  removed: string[]
  /** The guardian has signed but the envelope is still being finalised: left for a later run. */
  held: string[]
  /** Consent envelopes voided because their participant no longer needs consent (agreements ids). */
  voided: string[]
  errors: Array<{ consentId: string; error: string }>
}

/**
 * Settles what the hooks did not: a pending consent past its window is expired and
 * its registration removed, unless the guardian signed (a missed completion, which
 * settles it signed) or is part-way through finalising (held). A declined or
 * expired consent whose removal failed is tried again. A consent envelope left open
 * after a correction to 18 or over removed its pending row is voided. Run daily, behind the flag,
 * from the membership-expiry cron.
 */
export async function sweepTenantGuardianConsents(
  db: SupabaseClient,
  opts: RemovalOptions & VoidOptions & { limit?: number } = {},
): Promise<ConsentSweepResult> {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const limit = opts.limit ?? SWEEP_BATCH
  const result: ConsentSweepResult = { scanned: 0, signed: [], expired: [], removed: [], held: [], voided: [], errors: [] }

  // Removals that failed before, longest-waiting first.
  const { data: retries, error: retryError } = await db
    .from('tenant_guardian_consents')
    .select(CONSENT_COLUMNS)
    .in('status', ['declined', 'expired'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order('next_attempt_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (retryError) throw new Error(`Reading consents awaiting removal failed: ${retryError.message}`)
  for (const row of (retries ?? []) as ConsentRow[]) {
    result.scanned += 1
    try {
      if ((await removeUnconsentedRegistration(db, row, row.status === 'declined' ? 'declined' : 'expired', { ...opts, now })) === 'removed') {
        result.removed.push(row.id)
      }
    } catch (err) {
      result.errors.push({ consentId: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Pending consents whose window has closed.
  const { data: due, error: dueError } = await db
    .from('tenant_guardian_consents')
    .select(CONSENT_COLUMNS)
    .eq('status', 'pending')
    .lte('expires_at', nowIso)
    .order('expires_at', { ascending: true })
    .limit(limit)
  if (dueError) throw new Error(`Reading expired consents failed: ${dueError.message}`)
  for (const row of (due ?? []) as ConsentRow[]) {
    result.scanned += 1
    try {
      const envelope = await consentEnvelopeState(db, row.participant_id)
      if (envelope.state === 'completed') {
        if (await settleTenantGuardianConsentSigned(db, { id: envelope.id, envelope_type: TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE, participant_id: row.participant_id, tenant_id: row.tenant_id }, now)) {
          result.signed.push(row.id)
        }
        continue
      }
      if (envelope.state === 'guardian_signed' || envelope.state === 'unknown') {
        result.held.push(row.id)
        continue
      }
      const { data: moved, error } = await db
        .from('tenant_guardian_consents')
        .update({ status: 'expired', settled_at: nowIso })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
      if (error) throw new Error(error.message)
      if (!moved?.length) continue // settled meanwhile
      result.expired.push(row.id)
      await recordConsentAudit('registration.guardian_consent.expire', row, {}, { db })
      if ((await removeUnconsentedRegistration(db, { ...row, status: 'expired' }, 'expired', { ...opts, now })) === 'removed') {
        result.removed.push(row.id)
      }
    } catch (err) {
      result.errors.push({ consentId: row.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  await voidOrphanedConsentEnvelopes(db, result, { ...opts, limit })
  return result
}

/** Open consent envelopes per read in the sweep's void pass. */
export const OPEN_ENVELOPE_PAGE = 100

export interface VoidOptions {
  /** The void, replaceable in tests. */
  voidEnvelope?: (row: { envelope_id: string; provider: string | null }) => Promise<void>
}

async function engineVoid(db: SupabaseClient, row: { envelope_id: string; provider: string | null }): Promise<void> {
  const { voidEnvelopeRow } = await import('@/lib/esign/operations')
  await voidEnvelopeRow(db, row, 'Guardian consent no longer needed')
}

/**
 * Voids a consent envelope still out for signature whose participant has no
 * consent row any more: a date-of-birth correction made them 18 or over, and the
 * database removed the still-pending row (zzz_participants_open_tenant_guardian_consent),
 * so the guardian is not left with a form to sign. Every consent envelope is issued
 * after its participant's row exists, so an envelope with no row is one of these.
 * A failed read voids nothing and is recorded. At most `limit` voids a run.
 */
async function voidOrphanedConsentEnvelopes(
  db: SupabaseClient,
  result: ConsentSweepResult,
  opts: VoidOptions & { limit: number },
): Promise<void> {
  let after: string | null = null
  try {
    while (result.voided.length < opts.limit) {
      let query = db
        .from('agreements')
        .select('id, envelope_id, provider, participant_id')
        .eq('envelope_type', TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE)
        .in('status', ['created', 'sent', 'delivered'])
        .not('participant_id', 'is', null)
      if (after) query = query.gt('id', after)
      // A small page, so the participant ids below fit in one request's URL.
      const { data, error } = await query.order('id', { ascending: true }).limit(OPEN_ENVELOPE_PAGE)
      if (error) throw new Error(`Reading open consent envelopes failed: ${error.message}`)
      const envelopes = (data ?? []) as Array<{ id: string; envelope_id: string; provider: string | null; participant_id: string }>
      if (!envelopes.length) return
      const last = envelopes[envelopes.length - 1].id
      if (after && !(last > after)) throw new Error('Reading open consent envelopes did not advance')
      after = last

      const participants = [...new Set(envelopes.map((e) => e.participant_id))]
      const { data: rows, error: rowError } = await db
        .from('tenant_guardian_consents')
        .select('participant_id')
        .in('participant_id', participants)
      if (rowError) throw new Error(`Reading consents for open envelopes failed: ${rowError.message}`)
      const withConsent = new Set(((rows ?? []) as Array<{ participant_id: string }>).map((r) => r.participant_id))

      for (const e of envelopes) {
        if (withConsent.has(e.participant_id)) continue
        if (result.voided.length >= opts.limit) return
        try {
          const row = { envelope_id: e.envelope_id, provider: e.provider }
          await (opts.voidEnvelope ? opts.voidEnvelope(row) : engineVoid(db, row))
          result.voided.push(e.id)
        } catch (err) {
          result.errors.push({ consentId: `agreement:${e.id}`, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
  } catch (err) {
    result.errors.push({ consentId: 'open-envelopes', error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Where the participant's consent envelope stands. `guardian_signed` means the
 * guardian's signature is in but the envelope is not completed yet (finalising);
 * `unknown` means a read failed, which the sweep treats as "do not remove".
 */
async function consentEnvelopeState(
  db: SupabaseClient,
  participantId: string,
): Promise<{ state: 'completed'; id: string } | { state: 'guardian_signed' | 'open' | 'none' | 'unknown' }> {
  const { data, error } = await db
    .from('agreements')
    .select('id, status')
    .eq('participant_id', participantId)
    .eq('envelope_type', TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE)
  if (error) return { state: 'unknown' }
  const rows = (data ?? []) as Array<{ id: string; status: string }>
  const done = rows.find((r) => r.status === 'completed')
  if (done) return { state: 'completed', id: done.id }
  const live = rows.filter((r) => r.status === 'sent' || r.status === 'delivered').map((r) => r.id)
  if (!live.length) return { state: rows.length ? 'open' : 'none' }
  const { count, error: rErr } = await db
    .from('agreement_recipients')
    .select('id', { count: 'exact', head: true })
    .in('envelope_row', live)
    .eq('role_name', 'Guardian')
    .eq('status', 'completed')
  if (rErr) return { state: 'unknown' }
  return (count ?? 0) > 0 ? { state: 'guardian_signed' } : { state: 'open' }
}

// ── Who event mail leaves out ───────────────────────────────────────────────

/** Rows per read of the consents event mail leaves out. Paging goes on past a short page. */
export const CONSENT_READ_PAGE = 1000

/**
 * The tenant's participants whose consent is not signed (pending, or declined or
 * expired and awaiting removal). Tenant event emails leave them out
 * (lib/event-emails/audiences.ts). Throws on a failed read, so a send fails and is
 * retried rather than reaching a participant it must not.
 */
export async function unconsentedParticipantIds(db: SupabaseClient, tenantId: string): Promise<Set<string>> {
  if (!isTenantRow(tenantId)) return new Set()
  // Paged by participant_id until a page comes back empty, never stopping at a
  // short page: PostgREST caps the rows one read returns (max-rows), and a cap
  // smaller than the page asked for must not end the read early and let a
  // pending participant into the send.
  const ids = new Set<string>()
  let after: string | null = null
  for (;;) {
    let query = db
      .from('tenant_guardian_consents')
      .select('participant_id')
      .eq('tenant_id', tenantId)
      .neq('status', 'signed')
    if (after) query = query.gt('participant_id', after)
    const { data, error } = await query.order('participant_id', { ascending: true }).limit(CONSENT_READ_PAGE)
    if (error) throw new Error(`Reading guardian consents failed: ${error.message}`)
    const rows = (data ?? []) as Array<{ participant_id: string }>
    if (!rows.length) return ids
    const last = rows[rows.length - 1].participant_id
    // A page that does not move past the last one would loop: fail the send instead.
    if (after && !(last > after)) throw new Error('Reading guardian consents failed: the read did not advance')
    for (const r of rows) ids.add(r.participant_id)
    after = last
  }
}
