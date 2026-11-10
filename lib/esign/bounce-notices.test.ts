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

import { announceBounces, announceCorrection, announceSuggestion, otherSigner, isTwoPersonForm } from './bounce-notices'
import { hashToken } from './email-change-tokens'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const TENANT = '11111111-1111-4111-8111-111111111111'
// Another tenant with no Reply-To, so no sender (lib/event-emails/tenant-mail.ts).
const QUIET = '33333333-3333-4333-8333-333333333333'
const ROCKET_FROM = '"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>'

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
    tenants: [
      { id: TENANT, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } },
      { id: QUIET, display_name: 'Quiet Org', branding: {} },
    ],
  })
  return fake
}

const emailsTo = () => sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)
const emailTo = (to: string) => sendEmail.mock.calls.map((c) => c[0] as { to: string; subject: string; html: string; text: string }).find((e) => e.to === to)

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  eventManagerAudienceClerkIds.mockResolvedValue([])
  staffAudienceMemberIds.mockResolvedValue([])
})

// S5 B14 follow-up: on another tenant's form, the notices to signers and group
// organisers go from that tenant's sender, or not at all; never as Stellr.
describe("another tenant's form: who the family's notices are from", () => {
  const twoPerson = (guardianEmail: string, guardianStatus: string, minorEmail: string, minorStatus: string) => [
    { id: 'r-g', envelope_row: 'agr-1', recipient_id: '1', role_name: 'Guardian', name: 'Ash Stone', email: guardianEmail, status: guardianStatus, routing_order: 1, bounce_notified_email: null, invite_error: null },
    { id: 'r-m', envelope_row: 'agr-1', recipient_id: '2', role_name: 'Minor', name: 'Olive Stone', email: minorEmail, status: minorStatus, routing_order: 2, bounce_notified_email: null, invite_error: null },
  ]

  it('flag on: the 15-year-old and the organisers hear from the tenant, replies to the tenant, and the copy does not name Stellr', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const fake = setup({ agreement: { tenant_id: TENANT, provider: 'native' }, registration: null })
    expect(await announceBounces(fake.client, 'agr-1')).toBe(1)
    const student = emailTo('olive@school.test') as unknown as Record<string, string>
    expect(student).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
    expect(student.text).toContain('The event organiser checks it')
    expect(student.text).not.toContain('Stellr checks')
  })

  it('flag on, group registration: the organiser’s notice goes from the tenant’s sender', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const fake = setup({ agreement: { tenant_id: TENANT, provider: 'native' } })
    await announceBounces(fake.client, 'agr-1')
    for (const to of ['teacher@school.test', 'poc@school.test', 'olive@school.test']) {
      expect(emailTo(to), to).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
    }
  })

  it.each([
    ['the flag is off', '', TENANT],
    ['the tenant has no sender', 'true', QUIET],
  ])('%s: staff are still told, but no signer or organiser email goes and no change link is made', async (_what, flag, tenant) => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', flag)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = setup({ agreement: { tenant_id: tenant, provider: 'native' } })
    expect(await announceBounces(fake.client, 'agr-1')).toBe(1)
    expect((notifyCommunityAdmins.mock.calls[0] as unknown[])[1]).toEqual({ tenantId: tenant })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(fake.table('agreement_email_changes')).toHaveLength(0)
  })

  it('a bounced student on a tenant form: the guardian’s link comes from the tenant, or not at all', async () => {
    const recipients = twoPerson('ash@home.test', 'completed', 'olive@dead.test', 'autoresponded')
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const on = setup({ agreement: { tenant_id: TENANT, provider: 'native' }, recipients, registration: null })
    await announceBounces(on.client, 'agr-1')
    expect(emailTo('ash@home.test')).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })

    sendEmail.mockClear()
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    const off = setup({ agreement: { tenant_id: TENANT, provider: 'native' }, recipients: twoPerson('ash@home.test', 'completed', 'olive@dead.test', 'autoresponded'), registration: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await announceBounces(off.client, 'agr-1')
    expect(emailsTo()).not.toContain('ash@home.test')
  })

  it('announceCorrection: the other signer and the organisers hear from the tenant, or not at all', async () => {
    const correct = (client: Parameters<typeof announceCorrection>[0], actor: Parameters<typeof announceCorrection>[1]['actor']) =>
      announceCorrection(client, { agreementId: 'agr-1', recipientId: '1', oldEmail: 'ash@dead.test', newEmail: 'ash@new.test', actor })
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    await correct(setup({ agreement: { tenant_id: TENANT } }).client, { kind: 'organiser', memberId: 'm-teacher', role: 'teacher' })
    const student = emailTo('olive@school.test') as unknown as Record<string, string>
    expect(student).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })
    expect(student.text).toContain('contact the event organiser')
    expect(student.text).not.toContain('Stellr')

    sendEmail.mockClear()
    await correct(setup({ agreement: { tenant_id: TENANT } }).client, { kind: 'guardian' })
    expect(emailTo('poc@school.test')).toMatchObject({ from: ROCKET_FROM })

    sendEmail.mockClear()
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await correct(setup({ agreement: { tenant_id: TENANT } }).client, { kind: 'organiser', memberId: 'm-teacher', role: 'teacher' })
    await correct(setup({ agreement: { tenant_id: TENANT } }).client, { kind: 'guardian' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('announceSuggestion: the organisers hear from the tenant, or not at all', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    await announceSuggestion(setup({ agreement: { tenant_id: TENANT } }).client, { agreementId: 'agr-1', suggested: 'ash@new.test' })
    expect(emailTo('poc@school.test')).toMatchObject({ from: ROCKET_FROM, replyTo: 'events@rocket.example.org' })

    sendEmail.mockClear()
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await announceSuggestion(setup({ agreement: { tenant_id: TENANT } }).client, { agreementId: 'agr-1', suggested: 'ash@new.test' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('Stellr’s form, flag on or off: no sender keys and no tenants read', async () => {
    for (const flag of ['', 'true']) {
      vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', flag)
      sendEmail.mockClear()
      const fake = setup()
      const read = vi.spyOn(fake.client as unknown as { from: (t: string) => unknown }, 'from')
      await announceBounces(fake.client, 'agr-1')
      expect(read.mock.calls.map((c) => c[0])).not.toContain('tenants')
      expect(sendEmail).toHaveBeenCalled()
      for (const [msg] of sendEmail.mock.calls as unknown as [Record<string, unknown>][]) {
        expect(msg).not.toHaveProperty('from')
        expect(msg).not.toHaveProperty('replyTo')
      }
    }
  })
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

  it("another tenant's form: its own admins, and email only (the bell is Stellr's), from the tenant's sender", async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
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
