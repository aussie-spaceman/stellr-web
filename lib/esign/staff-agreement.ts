import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AGREEMENT_TITLE, type IssuePlan } from '@/lib/esign/native/plan'
import { loadActiveTemplate, TemplateUnavailableError } from '@/lib/esign/native/templates-store'
import { insertSigners } from '@/lib/esign/native/flow'
import { signingConfigured } from '@/lib/esign/native/tokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The Staff agreement (13 Nov 2026), on Stellr's own signing engine.
//
// One of the four prerequisites for the Staff role (lib/staff.ts). One signer,
// the Staff member, who signs as themselves. The wording is the owner's, drafted
// outside the repo and published under the 'staff' key in Admin → Agreement
// documents. Until it is published nothing can be issued, and nobody activates
// (fails closed). Native only: it never goes through DocuSign.
//
// What the research behind the role says it should cover (for the drafter):
// confidentiality that survives the role; platform-only use of data, no copies
// to personal devices or accounts; need-to-know; a safeguarding code (no
// private one-to-one contact with minors, never platform data for personal
// contact); consent to background checks and rescreening; a duty to report
// incidents and suspected abuse; MFA and device security; notice that access is
// logged; return or destroy data on exit; consequences; re-signing every 3 years.

export const STAFF_AGREEMENT_TEMPLATE = 'staff' as const
export const STAFF_AGREEMENT_ENVELOPE_TYPE = 'staff' as const
/** agreements.event_slug for a program-level row, as volunteer-program and membership use. */
export const STAFF_AGREEMENT_SLUG = 'staff-role'
/** Recorded on agreements.agreement_version: the Staff agreement's own series. */
export const STAFF_AGREEMENT_VERSION = 'staff-1'

export interface StaffAgreementInput {
  memberId: string
  firstName: string
  lastName: string
  email: string
}

const clean = (s: string | null | undefined) => (s ?? '').trim()

export function planStaffAgreement(input: StaffAgreementInput): IssuePlan {
  const name = `${clean(input.firstName)} ${clean(input.lastName)}`.trim()
  const email = clean(input.email).toLowerCase()
  return {
    templateKey: STAFF_AGREEMENT_TEMPLATE,
    label: AGREEMENT_TITLE.staff,
    prefill: { StaffName: name, StaffEmail: email },
    names: { member: name },
    signers: [{ role: 'member', name, email, memberId: input.memberId, order: 1 }],
    minorSubject: false,
    subjectBirthYear: null,
  }
}

/** Whether a staff agreement can be issued at all: signing is configured and the document is published. Never throws. */
export async function staffAgreementDocumentReady(db: SupabaseClient): Promise<boolean> {
  if (!signingConfigured()) return false
  try {
    await loadActiveTemplate(db, STAFF_AGREEMENT_TEMPLATE)
    return true
  } catch (err) {
    if (!(err instanceof TemplateUnavailableError)) {
      console.error('[staff-agreement] document lookup failed:', err instanceof Error ? err.message : err)
    }
    return false
  }
}

/**
 * Records the staff agreement and its signer, and emails the signing link
 * (through the signing outbox, inside today's budget; what does not fit goes
 * with the next send). Returns the agreements row id. Throws when it cannot,
 * leaving no envelope behind.
 */
export async function issueStaffAgreement(db: SupabaseClient, input: StaffAgreementInput): Promise<{ agreementId: string }> {
  if (!signingConfigured()) throw new Error('Stellr signing is not configured (ESIGN_TOKEN_SECRET)')
  const plan = planStaffAgreement(input)
  if (!plan.signers[0].name || !plan.signers[0].email) throw new Error('A name and email are required for the staff agreement')
  const template = await loadActiveTemplate(db, STAFF_AGREEMENT_TEMPLATE)

  const { data, error } = await db
    .from('agreements')
    .insert({
      participant_id: null,
      member_id: input.memberId,
      event_slug: STAFF_AGREEMENT_SLUG,
      event_title: AGREEMENT_TITLE.staff,
      tenant_id: STELLR_TENANT_ID,
      envelope_id: `native-${randomUUID()}`,
      provider: 'native',
      envelope_type: STAFF_AGREEMENT_ENVELOPE_TYPE,
      status: 'sent',
      signer_name: plan.signers[0].name,
      signer_email: plan.signers[0].email,
      signers_total: 1,
      signers_completed: 0,
      agreement_version: STAFF_AGREEMENT_VERSION,
      template_id: template.id,
      prefill: plan.prefill,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Recording the staff agreement failed: ${error?.message ?? 'no row'}`)
  const agreementId = (data as { id: string }).id
  let active
  try {
    active = await insertSigners(db, agreementId, plan, template)
  } catch (err) {
    const { error: takeBack } = await db.from('agreements').delete().eq('id', agreementId)
    if (takeBack) console.error('[staff-agreement] could not take back envelope', agreementId, takeBack.message)
    throw err
  }
  // Never throws: a link that could not go waits in the outbox for the next send.
  const { sendInvites } = await import('@/lib/esign/outbox')
  await sendInvites(db, active)
  return { agreementId }
}
