// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { notifyCommunityAdmins, notifyMember, sendEmail, eventManagerAudienceClerkIds, staffAudienceMemberIds } = vi.hoisted(() => ({
  notifyCommunityAdmins: vi.fn(async (..._a: unknown[]) => {}),
  notifyMember: vi.fn(async (..._a: unknown[]) => {}),
  sendEmail: vi.fn(async (..._a: unknown[]) => ({ id: 're_x' })),
  eventManagerAudienceClerkIds: vi.fn(async (..._a: unknown[]) => [] as string[]),
  staffAudienceMemberIds: vi.fn(async (..._a: unknown[]) => [] as string[]),
}))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins, notifyMember }))
vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/authz/audiences', () => ({ eventManagerAudienceClerkIds, staffAudienceMemberIds }))

import { announceBounces, announceCorrection, otherSigner, isTwoPersonForm } from './bounce-notices'
import { hashToken } from './email-change-tokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const TENANT = '11111111-1111-4111-8111-111111111111'

type Over = {
  agreement?: Record<string, unknown>
  recipients?: Record<string, unknown>[]
  registration?: Record<string, unknown> | null
  members?: Record<string, unknown>[]
}

function setup(over: Over = {}) {
  const fake = fakeSupabase({
    agreements: [{
      id: 'agr-1', tenant_id: null, event_slug: 'mn-edc', event_title: 'Minnesota EDC', minor_name: 'Olive Stone',
      signer_name: 'Ash Stone', participant_id: 'p-1', provider: 'docusign', status: 'sent', ...over.agreement,
    }],
    agreement_recipients: over.recipients ?? [
      { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: 'Guardian', name: 'Ash Stone', email: 'ash@dead.test', status: 'autoresponded', routing_order: 1, bounce_notified_email: null, invite_error: null },
      { id: 'r-m', envelope_row: 'agr-1', recipient_id: '2', role_name: 'Minor', name: 'Olive Stone', email: 'olive@school.test', status: 'sent', routing_order: 2, bounce_notified_email: null, invite_error: null },
    ],
    participants: [{ id: 'p-1', registration_id: over.registration === null ? null : 'reg-1' }],
    registrations: over.registration === null ? [] : [{
      id: 'reg-1', type: 'group', registrant_role: 'teacher', teacher_member_id: 'm-teacher',
      teacher_email: 'teacher@school.test', teacher_poc_email: 'poc@school.test', ...over.registration,
    }],
    members: over.members ?? [
      { id: 'm-teacher', email: 'teacher@school.test', clerk_user_id: 'user_t', is_active: true },
      { id: 'm-em', email: 'em@stellr.test', clerk_user_id: 'user_em', is_active: true },
    ],
    agreement_email_changes: [],
  })
  return fake
}

const emailsTo = () => sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)
const emailTo = (to: string) => sendEmail.mock.calls.map((c) => c[0] as { to: string; subject: string; html: string; text: string }).find((e) => e.to === to)

beforeEach(() => {
  vi.clearAllMocks()
  eventManagerAudienceClerkIds.mockResolvedValue([])
  staffAudienceMemberIds.mockResolvedValue([])
})

describe('who is told when a guardian’s email bounces (group registration)', () => {
  it('tells staff, the event manager, the organisers and the student, once', async () => {
    eventManagerAudienceClerkIds.mockResolvedValue(['user_em'])
    const fake = setup()
    expect(await announceBounces(fake.client, 'agr-1')).toBe(1)

    // Staff: the tenant's admin audience, full address and a roster link.
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    const [staff, opts] = notifyCommunityAdmins.mock.calls[0] as [{ body: string; email: { html: string } }, { tenantId: string }]
    expect(opts).toEqual({ tenantId: STELLR_TENANT_ID })
    expect(staff.body).toContain('ash@dead.test')
    expect(staff.body).toContain("Also told: the group's teacher and the other signer on the form")
    expect(staff.email.html).toContain('/admin/competitions/mn-edc')

    // The event manager (a member) and the registrant teacher get their usual channels.
    const told = notifyMember.mock.calls.map((c) => c[0])
    expect(told).toContain('m-em')
    expect(told).toContain('m-teacher')
    const teacher = notifyMember.mock.calls.find((c) => c[0] === 'm-teacher')![1] as { body: string }
    expect(teacher.body).toContain('ash@dead.test') // organisers see it in full
    expect(teacher.body).toContain('Fix email')

    // The nominated teacher has no account: an email.
    expect(emailsTo()).toContain('poc@school.test')

    // The student: masked address, a one-time suggestion link.
    const student = emailTo('olive@school.test')!
    expect(student.text).toContain('a***@dead.test')
    expect(student.text).not.toContain('ash@dead.test')
    expect(student.text).toMatch(/\/sign\/email#[A-Za-z0-9_-]{43}/)
    expect(student.text).toContain('Your teacher checks it')

    // Never to the dead address.
    expect(emailsTo()).not.toContain('ash@dead.test')

    // The link is stored only as a hash.
    const token = /\/sign\/email#([A-Za-z0-9_-]{43})/.exec(student.text)![1]
    const [change] = fake.table('agreement_email_changes')
    expect(change).toMatchObject({ kind: 'suggestion', status: 'link_sent', recipient_id: '1', old_email: 'ash@dead.test', requested_by_email: 'olive@school.test' })
    expect(change.token_hash).toBe(hashToken(token))
    expect(JSON.stringify(change)).not.toContain(token)
  })

  it('does not announce the same bounce twice, and announces a corrected address that bounces again', async () => {
    const fake = setup()
    expect(await announceBounces(fake.client, 'agr-1')).toBe(1)
    expect(await announceBounces(fake.client, 'agr-1')).toBe(0)
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)

    const guardian = fake.table('agreement_recipients').find((r) => r.id === 'r-g')!
    guardian.email = 'ash@also-dead.test'
    expect(await announceBounces(fake.client, 'agr-1')).toBe(1)
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(2)
  })

  it('does not tell an organiser or event manager twice when they are also staff', async () => {
    staffAudienceMemberIds.mockResolvedValue(['m-teacher', 'm-em'])
    eventManagerAudienceClerkIds.mockResolvedValue(['user_em'])
    const fake = setup()
    await announceBounces(fake.client, 'agr-1')
    expect(notifyMember).not.toHaveBeenCalled()
  })
})

describe('the other signer', () => {
  it('a bounced student: the guardian gets a link to correct it directly', async () => {
    const fake = setup({
      recipients: [
        { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: 'Guardian', name: 'Ash Stone', email: 'ash@home.test', status: 'completed', routing_order: 1, bounce_notified_email: null, invite_error: null },
        { id: 'r-m', envelope_row: 'agr-1', recipient_id: '2', role_name: 'Minor', name: 'Olive Stone', email: 'olive@dead.test', status: 'autoresponded', routing_order: 2, bounce_notified_email: null, invite_error: null },
      ],
      registration: null,
    })
    await announceBounces(fake.client, 'agr-1')
    const parent = emailTo('ash@home.test')!
    expect(parent.subject).toBe("We couldn't reach Olive Stone")
    expect(parent.text).toContain('o***@dead.test')
    expect(fake.table('agreement_email_changes')[0]).toMatchObject({ kind: 'direct', recipient_id: '2' })
  })

  it('a family sharing one inbox: nobody else on the form to tell', async () => {
    const fake = setup({
      recipients: [
        { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: 'Guardian', name: 'Ash', email: 'home@dead.test', status: 'autoresponded', routing_order: 1, bounce_notified_email: null, invite_error: null },
        { id: 'r-m', envelope_row: 'agr-1', recipient_id: '2', role_name: 'Minor', name: 'Olive', email: 'HOME@dead.test', status: 'created', routing_order: 2, bounce_notified_email: null, invite_error: null },
      ],
    })
    await announceBounces(fake.client, 'agr-1')
    expect(emailsTo()).not.toContain('HOME@dead.test')
    expect(emailsTo()).not.toContain('home@dead.test')
    expect(fake.table('agreement_email_changes')).toHaveLength(0)
  })

  it('a one-person form has no other signer', () => {
    const adult = [{ id: 'a', recipient_id: '1', role_name: 'Adult', name: 'A', email: 'a@dead.test', status: 'autoresponded' }]
    expect(isTwoPersonForm(adult)).toBe(false)
    expect(otherSigner(adult, adult[0])).toBeNull()
  })
})

describe('scope', () => {
  it('a form no longer live: staff hear of it, nobody else, and no link is made', async () => {
    const fake = setup({ agreement: { status: 'completed' } })
    await announceBounces(fake.client, 'agr-1')
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(notifyMember).not.toHaveBeenCalled()
    expect(fake.table('agreement_email_changes')).toHaveLength(0)
  })

  it("another tenant's form: its own admins, and email only (the bell is Stellr's)", async () => {
    const fake = setup({ agreement: { tenant_id: TENANT } })
    await announceBounces(fake.client, 'agr-1')
    expect((notifyCommunityAdmins.mock.calls[0] as unknown[])[1]).toEqual({ tenantId: TENANT })
    expect(notifyMember).not.toHaveBeenCalled()
    expect(emailsTo()).toContain('teacher@school.test')
  })

  it('a suppressed send reads as not sent, not as bounced', async () => {
    const fake = setup()
    await announceBounces(fake.client, 'agr-1', { kind: 'suppressed' })
    const [staff] = notifyCommunityAdmins.mock.calls[0] as [{ email: { subject: string } }]
    expect(staff.email.subject).toBe('Action needed: a signing email was not sent for Olive Stone')
  })
})

describe('registrant-controlled text (deep review DS-5)', () => {
  it('is escaped in every HTML notice', async () => {
    const fake = setup({
      agreement: { minor_name: '<img src=x onerror=alert(1)>', event_title: '<u>Event</u>' },
      recipients: [
        { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: '<i>role</i>', name: '<b>x</b>', email: 'a@b.c"><script>alert(1)</script>', status: 'autoresponded', routing_order: 1, bounce_notified_email: null, invite_error: null },
      ],
    })
    await announceBounces(fake.client, 'agr-1')
    const htmls = [
      (notifyCommunityAdmins.mock.calls[0][0] as { email: { html: string } }).email.html,
      ...notifyMember.mock.calls.map((c) => (c[1] as { email: { html: string } }).email.html),
      ...sendEmail.mock.calls.map((c) => (c[0] as { html: string }).html),
    ]
    expect(htmls.length).toBeGreaterThan(1)
    for (const html of htmls) {
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<img src=x')
      expect(html).not.toContain('<b>x</b>')
    }
    expect(htmls[0]).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('announceCorrection', () => {
  it('an organiser’s change: staff, the event manager and the other signer (masked) are told', async () => {
    eventManagerAudienceClerkIds.mockResolvedValue(['user_em'])
    const fake = setup()
    await announceCorrection(fake.client, {
      agreementId: 'agr-1', recipientId: '1', oldEmail: 'ash@dead.test', newEmail: 'ash@new.test',
      actor: { kind: 'organiser', memberId: 'm-teacher', role: 'teacher' },
    })
    const [staff] = notifyCommunityAdmins.mock.calls[0] as [{ body: string }]
    expect(staff.body).toContain("changed by the group's teacher: ash@dead.test → ash@new.test")
    expect(notifyMember.mock.calls.map((c) => c[0])).toEqual(['m-em'])
    const student = emailTo('olive@school.test')!
    expect(student.text).toContain('a***@new.test')
    expect(student.text).not.toContain('ash@new.test')
  })

  it("a parent's change: the organisers are told, the actor is not emailed back", async () => {
    const fake = setup({
      recipients: [
        { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: 'Guardian', name: 'Ash', email: 'ash@home.test', status: 'completed', routing_order: 1, bounce_notified_email: null, invite_error: null },
        { id: 'r-m', envelope_row: 'agr-1', recipient_id: '2', role_name: 'Minor', name: 'Olive', email: 'olive@new.test', status: 'sent', routing_order: 2, bounce_notified_email: null, invite_error: null },
      ],
    })
    await announceCorrection(fake.client, { agreementId: 'agr-1', recipientId: '2', oldEmail: 'olive@dead.test', newEmail: 'olive@new.test', actor: { kind: 'guardian' } })
    expect(notifyMember.mock.calls.map((c) => c[0])).toContain('m-teacher')
    expect(emailsTo()).toContain('poc@school.test')
    expect(emailsTo()).not.toContain('ash@home.test')
  })
})
