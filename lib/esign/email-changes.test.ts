// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { correctAgreementRecipient, announceCorrection, announceSuggestion } = vi.hoisted(() => ({
  correctAgreementRecipient: vi.fn(),
  announceCorrection: vi.fn(async (..._a: unknown[]) => {}),
  announceSuggestion: vi.fn(async (..._a: unknown[]) => {}),
}))
vi.mock('@/lib/agreement-correction', async (orig) => ({
  ...(await orig<typeof import('@/lib/agreement-correction')>()),
  correctAgreementRecipient,
}))
vi.mock('@/lib/esign/bounce-notices', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/bounce-notices')>()),
  announceCorrection,
  announceSuggestion,
}))

import { correctFromRosterEdit, organiserCorrect, organiserDecide, organiserView, staffDecide, submitLink, viewLink } from './email-changes'
import { createChangeLink } from './email-change-tokens'

const TEACHER = { id: 'm-teacher', email: 'teacher@school.test' }
const POC = { id: 'm-poc', email: 'poc@school.test' }
const STUDENT_MANAGER = { id: 'm-sm', email: 'sm@school.test' }
const STRANGER = { id: 'm-x', email: 'x@else.test' }

function setup(over: { guardianStatus?: string; agreementStatus?: string; registrantRole?: string } = {}) {
  const fake = fakeSupabase({
    registrations: [{
      id: 'reg-1', type: 'group', registrant_role: over.registrantRole ?? 'teacher', teacher_member_id: 'm-teacher',
      teacher_email: 'teacher@school.test', teacher_poc_email: 'poc@school.test',
    }],
    participants: [
      { id: 'p-1', registration_id: 'reg-1', email: 'olive@school.test', school_email: null, event_role: 'participant' },
      { id: 'p-2', registration_id: 'reg-1', email: 'sib@school.test', school_email: 'sib@district.test', event_role: 'participant' },
      { id: 'p-3', registration_id: 'reg-2', email: 'other@school.test', school_email: null, event_role: 'participant' },
    ],
    agreements: [
      { id: 'agr-1', participant_id: 'p-1', status: over.agreementStatus ?? 'sent', event_slug: 'mn-edc', created_at: '2026-11-01T00:00:00Z', minor_name: 'Olive Stone', signer_name: 'Ash', event_title: 'MN EDC' },
      { id: 'agr-3', participant_id: 'p-3', status: 'sent', event_slug: 'mn-edc', created_at: '2026-11-01T00:00:00Z', minor_name: 'Other', signer_name: 'O', event_title: 'MN EDC' },
    ],
    agreement_recipients: [
      { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: 'Guardian', name: 'Ash Stone', email: 'ash@dead.test', status: over.guardianStatus ?? 'autoresponded', routing_order: 1 },
      { id: 'r-m', envelope_row: 'agr-1', recipient_id: '2', role_name: 'Minor', name: 'Olive Stone', email: 'olive@school.test', status: 'sent', routing_order: 2 },
      { id: 'r-3', envelope_row: 'agr-3', recipient_id: '1', role_name: 'Guardian', name: 'O', email: 'o@dead.test', status: 'autoresponded', routing_order: 1 },
    ],
    agreement_email_changes: [],
    email_suppressions: [{ email: 'known@bounced.test', reason: 'bounce' }],
  })
  return fake
}

const correct = (fake: ReturnType<typeof setup>, member: { id: string; email: string }, email: string, recipientId = '1') =>
  organiserCorrect(fake.client, { member, registrationId: 'reg-1', participantId: 'p-1', recipientId, email })

beforeEach(() => {
  vi.clearAllMocks()
  correctAgreementRecipient.mockResolvedValue({ kind: 'corrected', recipient: { email: 'x' } })
})

describe('an organiser fixes a bounced address', () => {
  it('the teacher fixes the guardian: the same form is corrected, recorded and announced', async () => {
    const fake = setup()
    expect(await correct(fake, TEACHER, ' Ash@Home.test ')).toEqual({ ok: true, email: 'ash@home.test' })
    expect(correctAgreementRecipient).toHaveBeenCalledWith(fake.client, { agreementId: 'agr-1', recipientId: '1', email: 'ash@home.test' })
    expect(fake.table('agreement_email_changes')[0]).toMatchObject({ kind: 'organiser', status: 'applied', old_email: 'ash@dead.test', new_email: 'ash@home.test', requested_by_member: 'm-teacher' })
    expect(announceCorrection).toHaveBeenCalledWith(fake.client, expect.objectContaining({ actor: { kind: 'organiser', memberId: 'm-teacher', role: 'teacher' } }))
  })

  it('the nominated teacher and a student manager registrant may too (owner decision)', async () => {
    expect((await correct(setup(), POC, 'ash@home.test')).ok).toBe(true)
    const sm = setup({ registrantRole: 'student_manager' })
    sm.table('registrations')[0].teacher_member_id = 'm-sm'
    sm.table('registrations')[0].teacher_email = 'sm@school.test'
    expect((await correct(sm, STUDENT_MANAGER, 'ash@home.test')).ok).toBe(true)
  })

  it('anyone else is refused', async () => {
    expect(await correct(setup(), STRANGER, 'ash@home.test')).toMatchObject({ ok: false, status: 404 })
    expect(correctAgreementRecipient).not.toHaveBeenCalled()
  })

  it('S5 A8: a tenant’s group whose teacher address is the member’s answers as a missing group, and nothing is corrected', async () => {
    const fake = setup()
    fake.table('registrations')[0].tenant_id = '11111111-1111-4111-8111-111111111111'
    fake.table('registrations')[0].teacher_member_id = null
    expect(await correct(fake, TEACHER, 'ash@home.test')).toEqual({ ok: false, status: 404, code: 'NOT_FOUND', error: 'Team not found' })
    expect(await organiserView(fake.client, TEACHER, 'reg-1', 'p-1')).toMatchObject({ ok: false, status: 404, error: 'Team not found' })
    expect(await organiserDecide(fake.client, { member: TEACHER, registrationId: 'reg-1', changeId: 'c-1', decision: 'approve' })).toMatchObject({ ok: false, status: 404, error: 'Team not found' })
    expect(await correctFromRosterEdit(fake.client, {
      member: TEACHER, registrationId: 'reg-1', participantId: 'p-1',
      before: { email: 'olive@school.test', emergency_contact_email: 'ash@dead.test' },
      after: { email: 'olive@school.test', emergency_contact_email: 'ash@home.test' },
    })).toBeNull()
    expect(correctAgreementRecipient).not.toHaveBeenCalled()
    // Stellr's own row, stamped or not yet backfilled, still opens.
    fake.table('registrations')[0].tenant_id = null
    expect((await correct(fake, TEACHER, 'ash@home.test')).ok).toBe(true)
  })

  it('only a bounced signer: a working address is staff’s to change', async () => {
    expect(await correct(setup({ guardianStatus: 'sent' }), TEACHER, 'ash@home.test')).toMatchObject({ ok: false, code: 'NOT_BOUNCED' })
  })

  it('refuses the organiser’s own address, and any student’s in the group', async () => {
    expect(await correct(setup(), TEACHER, 'teacher@school.test')).toMatchObject({ ok: false, code: 'OWN_ADDRESS' })
    expect(await correct(setup(), TEACHER, 'POC@school.test')).toMatchObject({ ok: false, code: 'OWN_ADDRESS' })
    expect(await correct(setup(), TEACHER, 'olive@school.test')).toMatchObject({ ok: false, code: 'STUDENT_ADDRESS' })
    expect(await correct(setup(), TEACHER, 'sib@district.test')).toMatchObject({ ok: false, code: 'STUDENT_ADDRESS' })
    // A student in another group is not this group's concern.
    expect((await correct(setup(), TEACHER, 'other@school.test')).ok).toBe(true)
  })

  it("a student's own address is allowed on their own part of the form", async () => {
    const fake = setup()
    fake.table('agreement_recipients').find((r) => r.id === 'r-m')!.status = 'autoresponded'
    fake.table('participants')[0].email = 'olive@new.test'
    expect((await correct(fake, TEACHER, 'olive@new.test', '2')).ok).toBe(true)
  })

  it('refuses an address that has bounced before, and the one that just bounced', async () => {
    expect(await correct(setup(), TEACHER, 'known@bounced.test')).toMatchObject({ ok: false, code: 'BOUNCED_BEFORE' })
    expect(await correct(setup(), TEACHER, 'ash@dead.test')).toMatchObject({ ok: false, code: 'UNCHANGED' })
  })

  it('refuses a participant from another group, and a form no longer live', async () => {
    const fake = setup()
    expect(await organiserCorrect(fake.client, { member: TEACHER, registrationId: 'reg-1', participantId: 'p-3', recipientId: '1', email: 'a@b.test' })).toMatchObject({ ok: false, status: 404 })
    expect(await correct(setup({ agreementStatus: 'completed' }), TEACHER, 'ash@home.test')).toMatchObject({ ok: false, code: 'NOT_LIVE' })
  })

  it('stops after three changes to one form in a day', async () => {
    const fake = setup()
    for (let i = 0; i < 3; i++) {
      fake.table('agreement_email_changes').push({ id: `c${i}`, agreement_id: 'agr-1', kind: 'organiser', created_at: new Date().toISOString() })
    }
    expect(await correct(fake, TEACHER, 'ash@home.test')).toMatchObject({ ok: false, status: 429 })
  })

  it('the view lists only bounced signers', async () => {
    const view = await organiserView(setup().client, TEACHER, 'reg-1', 'p-1')
    expect(view).toMatchObject({ ok: true, bounced: [{ recipientId: '1', roleLabel: 'parent/guardian', email: 'ash@dead.test' }], pending: [] })
  })

  it('a roster edit of the bounced guardian address fixes the form too', async () => {
    const fake = setup()
    const message = await correctFromRosterEdit(fake.client, {
      member: TEACHER, registrationId: 'reg-1', participantId: 'p-1',
      before: { email: 'olive@school.test', emergency_contact_email: 'ash@dead.test' },
      after: { email: 'olive@school.test', emergency_contact_email: 'ash@home.test' },
    })
    expect(message).toBe("The parent/guardian's consent form was sent again to the new address.")
    expect(correctAgreementRecipient).toHaveBeenCalledTimes(1)
    // An unrelated edit touches nothing.
    expect(await correctFromRosterEdit(fake.client, {
      member: TEACHER, registrationId: 'reg-1', participantId: 'p-1',
      before: { email: 'olive@school.test', emergency_contact_email: 'ash@home.test' },
      after: { email: 'olive@school.test', emergency_contact_email: 'ash@home.test' },
    })).toBeNull()
  })
})

describe('one-time links', () => {
  async function link(fake: ReturnType<typeof setup>, kind: 'direct' | 'suggestion', now = new Date()) {
    return createChangeLink(fake.client, {
      agreementId: 'agr-1',
      recipientId: kind === 'suggestion' ? '1' : '2',
      roleName: kind === 'suggestion' ? 'Guardian' : 'Minor',
      oldEmail: kind === 'suggestion' ? 'ash@dead.test' : 'olive@dead.test',
      kind,
      requestedByRole: kind === 'suggestion' ? 'Minor' : 'Guardian',
      requestedByEmail: kind === 'suggestion' ? 'olive@school.test' : 'ash@home.test',
      now,
    })
  }

  function studentBounced() {
    const fake = setup({ guardianStatus: 'completed' })
    const g = fake.table('agreement_recipients').find((r) => r.id === 'r-g')!
    g.email = 'ash@home.test'
    const m = fake.table('agreement_recipients').find((r) => r.id === 'r-m')!
    m.email = 'olive@dead.test'
    m.status = 'autoresponded'
    return fake
  }

  it("a student's suggestion waits for an adult, and the link works once", async () => {
    const fake = setup()
    const { token } = await link(fake, 'suggestion')
    expect(await viewLink(fake.client, token)).toMatchObject({ kind: 'suggestion', aboutFirstName: 'Olive', maskedOldEmail: 'a***@dead.test' })
    expect(await submitLink(fake.client, { token, email: 'ash@home.test' })).toEqual({ ok: true, outcome: 'pending' })
    expect(correctAgreementRecipient).not.toHaveBeenCalled()
    expect(announceSuggestion).toHaveBeenCalledWith(fake.client, { agreementId: 'agr-1', suggested: 'ash@home.test' })
    expect(fake.table('agreement_email_changes')[0]).toMatchObject({ status: 'pending', new_email: 'ash@home.test' })
    expect(await viewLink(fake.client, token)).toBeNull()
    expect(await submitLink(fake.client, { token, email: 'ash@other.test' })).toMatchObject({ ok: false, code: 'LINK' })
  })

  it("a parent's correction of the student's address is applied at once", async () => {
    const fake = studentBounced()
    const { token } = await link(fake, 'direct')
    expect(await submitLink(fake.client, { token, email: 'olive@new.test' })).toEqual({ ok: true, outcome: 'applied' })
    expect(correctAgreementRecipient).toHaveBeenCalledWith(fake.client, { agreementId: 'agr-1', recipientId: '2', email: 'olive@new.test' })
    expect(announceCorrection).toHaveBeenCalledWith(fake.client, expect.objectContaining({ actor: { kind: 'guardian' } }))
  })

  it("a parent may not send the student's part to themselves", async () => {
    const fake = studentBounced()
    const { token } = await link(fake, 'direct')
    expect(await submitLink(fake.client, { token, email: 'ash@home.test' })).toMatchObject({ ok: false, code: 'OWN_ADDRESS' })
    // A refused address does not spend the link.
    expect(await viewLink(fake.client, token)).not.toBeNull()
  })

  it('a failed engine call gives the link back', async () => {
    const fake = studentBounced()
    const { token } = await link(fake, 'direct')
    correctAgreementRecipient.mockRejectedValueOnce(new Error('DocuSign down'))
    expect(await submitLink(fake.client, { token, email: 'olive@new.test' })).toMatchObject({ ok: false, status: 502 })
    expect(await viewLink(fake.client, token)).not.toBeNull()
  })

  it('refuses an expired link, a malformed one, and one whose address was fixed another way', async () => {
    const old = setup()
    const { token } = await link(old, 'suggestion', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))
    expect(await viewLink(old.client, token)).toBeNull()
    expect(await viewLink(old.client, 'not-a-token')).toBeNull()
    const fixed = setup()
    const live = await link(fixed, 'suggestion')
    fixed.table('agreement_recipients').find((r) => r.id === 'r-g')!.status = 'sent'
    expect(await viewLink(fixed.client, live.token)).toBeNull()
  })

  it('a new link supersedes an unused older one', async () => {
    const fake = setup()
    const first = await link(fake, 'suggestion')
    await link(fake, 'suggestion')
    expect(await viewLink(fake.client, first.token)).toBeNull()
  })
})

describe('deciding a suggestion', () => {
  async function pending(fake: ReturnType<typeof setup>, email: string) {
    const { token } = await createChangeLink(fake.client, {
      agreementId: 'agr-1', recipientId: '1', roleName: 'Guardian', oldEmail: 'ash@dead.test', kind: 'suggestion',
      requestedByRole: 'Minor', requestedByEmail: 'olive@school.test',
    })
    await submitLink(fake.client, { token, email })
    return fake.table('agreement_email_changes')[0].id as string
  }

  it('the teacher approves: applied once, even if approved twice', async () => {
    const fake = setup()
    const id = await pending(fake, 'ash@home.test')
    expect(await organiserDecide(fake.client, { member: TEACHER, registrationId: 'reg-1', changeId: id, decision: 'approve' })).toEqual({ ok: true, decision: 'approve' })
    expect(correctAgreementRecipient).toHaveBeenCalledTimes(1)
    expect(await organiserDecide(fake.client, { member: TEACHER, registrationId: 'reg-1', changeId: id, decision: 'approve' })).toMatchObject({ ok: false })
    expect(correctAgreementRecipient).toHaveBeenCalledTimes(1)
  })

  it("the teacher may not approve the student's own address; staff may, after checking", async () => {
    const fake = setup()
    const id = await pending(fake, 'olive@school.test')
    expect(await organiserDecide(fake.client, { member: TEACHER, registrationId: 'reg-1', changeId: id, decision: 'approve' })).toMatchObject({ ok: false, code: 'STUDENT_ADDRESS' })
    expect(await staffDecide(fake.client, { agreementId: 'agr-1', changeId: id, decision: 'approve', memberId: 'm-admin', label: 'Admin' })).toEqual({ ok: true, decision: 'approve' })
  })

  it("another group's organiser cannot decide it", async () => {
    const fake = setup()
    const id = await pending(fake, 'ash@home.test')
    fake.table('registrations').push({ id: 'reg-2', type: 'group', registrant_role: 'teacher', teacher_member_id: 'm-x', teacher_email: 'x@else.test', teacher_poc_email: null })
    expect(await organiserDecide(fake.client, { member: STRANGER, registrationId: 'reg-2', changeId: id, decision: 'approve' })).toMatchObject({ ok: false, status: 404 })
  })

  it('a rejection changes nothing on the form', async () => {
    const fake = setup()
    const id = await pending(fake, 'ash@home.test')
    expect(await staffDecide(fake.client, { agreementId: 'agr-1', changeId: id, decision: 'reject', memberId: null, label: 'Admin' })).toEqual({ ok: true, decision: 'reject' })
    expect(correctAgreementRecipient).not.toHaveBeenCalled()
    expect(fake.table('agreement_email_changes')[0].status).toBe('rejected')
  })

  it('staff deciding on the wrong agreement id is refused', async () => {
    const fake = setup()
    const id = await pending(fake, 'ash@home.test')
    expect(await staffDecide(fake.client, { agreementId: 'agr-3', changeId: id, decision: 'approve', memberId: null, label: 'Admin' })).toMatchObject({ ok: false, status: 404 })
  })
})
