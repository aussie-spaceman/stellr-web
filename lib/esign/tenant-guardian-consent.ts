import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatFormDate } from '@/lib/docusign-form-data'
import { AGREEMENT_TITLE, type IssuePlan } from '@/lib/esign/native/plan'
import { loadActiveTemplate, TemplateUnavailableError } from '@/lib/esign/native/templates-store'
import { insertSigners } from '@/lib/esign/native/flow'
import { signingConfigured } from '@/lib/esign/native/tokens'
import { isTenantRow } from '@/lib/event-emails/tenant-mail'

// The guardian's consent for a 14-17-year-old at another organiser's event (S5
// wave 6, owner decision 10 Nov 2026), on the native signing engine.
//
// Platform-locked: every tenant's consent is issued from the one document
// published under the 'tenant_guardian_consent' key (Admin → Agreement
// documents, platform staff only). A tenant can neither choose nor edit it.
//
// The envelope has one signer, the parent or legal guardian, who confirms the
// child's birth year and attests to being the parent or legal guardian before
// anything is shown, as on Stellr's own minor consent. Nothing is collected
// from the child. The envelope is stamped with the tenant, so the signing
// outbox sends its invitation, reminders and completion email from the
// tenant's sender ("<Tenant> via Stellr") or holds them (lib/esign/outbox.ts).
//
// This only records the envelope and its signer. The caller sends the
// invitation through lib/event-emails/tenant-signing.ts (B14's checked call),
// so it can tell why an invitation could not go.

export const TENANT_GUARDIAN_CONSENT_TEMPLATE = 'tenant_guardian_consent' as const
export const TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE = 'tenant_guardian_consent' as const
/** Recorded on agreements.agreement_version: the consent's own series, not the V2.3 participation agreements. */
export const TENANT_GUARDIAN_CONSENT_VERSION = 'tgc-1'

export interface TenantGuardianConsentInput {
  tenantId: string
  participantId: string
  eventSlug: string
  eventTitle: string
  /** The tenant's display name, printed on the document as the organiser. */
  organiserName: string
  minorFirstName: string
  minorLastName: string
  /** YYYY-MM-DD. */
  minorDateOfBirth: string
  guardianFirstName: string
  guardianLastName: string
  guardianEmail: string
  relationship: string
}

const clean = (s: string | null | undefined) => (s ?? '').trim()

/** The signing plan: one guardian signer, the child as the document's subject. */
export function planTenantGuardianConsent(input: TenantGuardianConsentInput): IssuePlan {
  const minorName = `${clean(input.minorFirstName)} ${clean(input.minorLastName)}`.trim()
  const guardianName = `${clean(input.guardianFirstName)} ${clean(input.guardianLastName)}`.trim()
  const guardianEmail = clean(input.guardianEmail).toLowerCase()
  return {
    templateKey: TENANT_GUARDIAN_CONSENT_TEMPLATE,
    label: AGREEMENT_TITLE.tenantGuardianConsent,
    prefill: {
      MinorName: minorName,
      MinorDateOfBirth: formatFormDate(input.minorDateOfBirth),
      EventTitle: clean(input.eventTitle),
      OrganiserName: clean(input.organiserName),
      GuardianName: guardianName,
      GuardianEmail: guardianEmail,
      MinorRelationship: clean(input.relationship),
    },
    names: { guardian: guardianName },
    signers: [{ role: 'guardian', name: guardianName, email: guardianEmail, memberId: null, order: 1 }],
    minorSubject: true,
    subjectBirthYear: /^(\d{4})-/.exec(input.minorDateOfBirth)?.[1] ?? null,
  }
}

/**
 * Whether a consent envelope can be issued at all: signing is configured and a
 * consent document is published (approved, in production). Never throws.
 */
export async function tenantGuardianConsentDocumentReady(db: SupabaseClient): Promise<boolean> {
  if (!signingConfigured()) return false
  try {
    await loadActiveTemplate(db, TENANT_GUARDIAN_CONSENT_TEMPLATE)
    return true
  } catch (err) {
    if (!(err instanceof TemplateUnavailableError)) {
      console.error('[tenant-guardian-consent] document lookup failed:', err instanceof Error ? err.message : err)
    }
    return false
  }
}

/**
 * Records the consent envelope and its guardian signer. Sends nothing. Returns
 * the agreements row id. Throws when it cannot, leaving no envelope behind.
 */
export async function issueTenantGuardianConsent(db: SupabaseClient, input: TenantGuardianConsentInput): Promise<{ agreementId: string }> {
  if (!isTenantRow(input.tenantId)) throw new Error('Guardian consent for another organiser’s event only')
  if (!signingConfigured()) throw new Error('Stellr signing is not configured (ESIGN_TOKEN_SECRET)')
  const plan = planTenantGuardianConsent(input)
  if (!plan.signers[0].name || !plan.signers[0].email) throw new Error('A guardian name and email are required')
  const template = await loadActiveTemplate(db, TENANT_GUARDIAN_CONSENT_TEMPLATE)

  const { data, error } = await db
    .from('agreements')
    .insert({
      participant_id: input.participantId,
      member_id: null,
      event_slug: input.eventSlug,
      event_title: input.eventTitle,
      tenant_id: input.tenantId,
      envelope_id: `native-${randomUUID()}`,
      provider: 'native',
      envelope_type: TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE,
      status: 'sent',
      signer_name: plan.signers[0].name,
      signer_email: plan.signers[0].email,
      minor_name: plan.prefill.MinorName,
      signers_total: 1,
      signers_completed: 0,
      agreement_version: TENANT_GUARDIAN_CONSENT_VERSION,
      template_id: template.id,
      prefill: plan.subjectBirthYear ? { ...plan.prefill, SubjectBirthYear: plan.subjectBirthYear } : plan.prefill,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Recording the consent envelope failed: ${error?.message ?? 'no row'}`)
  const agreementId = (data as { id: string }).id
  try {
    await insertSigners(db, agreementId, plan, template)
  } catch (err) {
    // Nothing has been sent: take the envelope back so no signer-less envelope is left.
    const { error: takeBack } = await db.from('agreements').delete().eq('id', agreementId)
    if (takeBack) console.error('[tenant-guardian-consent] could not take back envelope', agreementId, takeBack.message)
    throw err
  }
  return { agreementId }
}
