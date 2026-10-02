import { describe, it, expect, vi } from 'vitest'

// render.ts reaches lib/community (server-only) through lib/email-render.
vi.mock('@/lib/community', () => ({
  tiptapToPlainText: () => '',
  RESOURCES_BUCKET: 'community-resources',
}))

const { EVENT_EMAIL_DEFAULTS, markdownToTiptap } = await import('./defaults')
const { eventMergeVars, recipientMergeVars, renderEventEmail, unknownTokens, formatClock, formatEventDate, tiptapToEmailText } =
  await import('./render')
const { attachAgreementLines, buildRecipients } = await import('./audiences')
const { scheduleDecision, scheduledSendDate, daysUntil } = await import('./schedule')

type Roster = Parameters<typeof buildRecipients>[0]

const EVENT = {
  slug: 'colorado-space-design-challenge',
  title: '2027 Colorado Space Design Challenge',
  date: '2026-10-03',
  venue: 'STEM School Highlands Ranch',
  city: 'Highlands Ranch',
  state: 'CO',
  startTime: '08:30',
  endTime: '17:30',
}

describe('starter emails', () => {
  it('use only merge fields the engine can fill', () => {
    for (const d of EVENT_EMAIL_DEFAULTS) {
      expect(unknownTokens(d.subject, markdownToTiptap(d.body)), d.key).toEqual([])
    }
  })

  it('converts paragraphs, bold and nested bullets to TipTap', () => {
    const doc = markdownToTiptap('Hi **there**,\n\n- one\n- two:\n  - nested')
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there', marks: [{ type: 'bold' }] }, { type: 'text', text: ',' }],
    })
    const list = doc.content[1]
    expect(list.type).toBe('bulletList')
    expect(list.content).toHaveLength(2)
    expect(list.content![1].content![1]).toMatchObject({ type: 'bulletList', content: [{ type: 'listItem' }] })
  })
})

describe('merge fields', () => {
  it('formats the event for a reader', () => {
    const v = eventMergeVars(EVENT, '2026-09-26')
    expect(v).toMatchObject({
      event_name: '2027 Colorado Space Design Challenge',
      event_venue: 'STEM School Highlands Ranch',
      event_city: 'Highlands Ranch, CO',
      event_date: 'Saturday, October 3',
      event_start_time: '8:30 AM',
      event_end_time: '5:30 PM',
      days_to_go: '7',
      event_link: expect.stringMatching(/\/events\/colorado-space-design-challenge$/),
      portal_link: expect.stringMatching(/\/sign-in$/),
    })
    expect(formatClock('12:05')).toBe('12:05 PM')
    expect(formatClock('00:15')).toBe('12:15 AM')
    expect(formatEventDate(null)).toBe('')
  })

  it('says who is registered from the reader’s side', () => {
    const base = { email: 'x@example.com', firstName: 'Jo', roles: [], payments: [] }
    expect(recipientMergeVars({ ...base, isParticipant: true, participantNames: ['Jo'] }).who_is_registered).toBe('you are')
    expect(recipientMergeVars({ ...base, isParticipant: false, participantNames: ['Lily'] }).who_is_registered).toBe('Lily is')
    expect(recipientMergeVars({ ...base, isParticipant: false, participantNames: ['Luke', 'Lily'] }).who_is_registered)
      .toBe('Luke and Lily are')
  })

  it('writes a pay link, an invoice note, or nothing', () => {
    const r = (payments: never[] | { participantName: string; payUrl: string | null; method: 'link' | 'invoice' | 'individual' }[]) =>
      recipientMergeVars({ email: 'p@example.com', firstName: 'Pat', roles: [], isParticipant: false, participantNames: [], payments }).payment_instructions
    expect(r([{ participantName: 'Lily', payUrl: 'https://www.stellreducation.org/register/x/pay/tok', method: 'link' }]))
      .toBe('You can pay securely here: https://www.stellreducation.org/register/x/pay/tok')
    expect(r([{ participantName: 'your group', payUrl: null, method: 'invoice' }])).toMatch(/paid by invoice/)
    expect(r([])).toBe('')
  })
})

describe('renderEventEmail', () => {
  const email = {
    subject: '{{event_name}}: hello {{first_name}}',
    body_json: markdownToTiptap('Hi {{first_name}},\n\n{{payment_instructions}}\n\nPortal: {{portal_link}}\n\n- one\n- two'),
  }

  it('fills fields, escapes values, links URLs and adds the signature', () => {
    const vars = {
      ...eventMergeVars(EVENT, '2026-09-26'),
      ...recipientMergeVars({ email: 'a@example.com', firstName: '<b>Al</b>', roles: [], isParticipant: true, participantNames: [], payments: [] }),
    }
    const out = renderEventEmail(email, vars)
    expect(out.subject).toBe('2027 Colorado Space Design Challenge: hello <b>Al</b>')
    expect(out.html).toContain('Hi &lt;b&gt;Al&lt;/b&gt;,')
    expect(out.html).not.toContain('<b>Al</b>')
    expect(out.html).toMatch(/<a href="https:\/\/[^"]+\/sign-in"/)
    expect(out.html).toContain('signature-logo.png')
    // No payment note → no empty paragraph left behind.
    expect(out.html).not.toContain('<p style="margin:0 0 16px"></p>')
    expect(out.text).toContain('- one\n- two')
    expect(out.text).toContain('Chief Inspiration Officer')
    expect(out.text).not.toContain('{{')
  })

  it('renders the pay link as a link', () => {
    const vars = {
      ...eventMergeVars(EVENT),
      ...recipientMergeVars({
        email: 'a@example.com', firstName: 'Al', roles: [], isParticipant: true, participantNames: [],
        payments: [{ participantName: 'Al', payUrl: 'https://www.stellreducation.org/register/x/pay/tok', method: 'link' }],
      }),
    }
    expect(renderEventEmail(email, vars).html).toContain('<a href="https://www.stellreducation.org/register/x/pay/tok"')
  })

  it('gives each address its own signing link, or says where the form is', () => {
    const body = { subject: 'Consent', body_json: markdownToTiptap('Hi {{first_name}},\n\n{{agreement_link}}') }
    const render = (agreements: Parameters<typeof recipientMergeVars>[0]['agreements']) =>
      renderEventEmail(body, {
        ...eventMergeVars(EVENT),
        ...recipientMergeVars({ email: 'pat@example.com', firstName: 'Pat', roles: [], isParticipant: false, participantNames: ['Sam'], payments: [], agreements }),
      })

    const one = render([{ participantName: 'Sam', provider: 'native', signUrl: 'https://www.stellreducation.org/sign#tok' }])
    expect(one.text).toContain('You can sign the form here: https://www.stellreducation.org/sign#tok')
    expect(one.html).toContain('<a href="https://www.stellreducation.org/sign#tok"')
    expect(one.html).toContain('>Sign now</a>')

    const two = render([
      { participantName: 'Sam', provider: 'native', signUrl: 'https://www.stellreducation.org/sign#a' },
      { participantName: 'Lily', provider: 'docusign', signUrl: null },
    ])
    expect(two.text).toContain('You can sign Sam’s form here: https://www.stellreducation.org/sign#a')
    expect(two.text).toContain('Lily’s form comes from DocuSign: look for an email from @docusign.net')

    const student = render([{ participantName: 'your', provider: 'native', signUrl: null, waiting: true }])
    expect(student.text).toContain('The parent or guardian signs first')

    // Nothing outstanding: no line, and no empty paragraph.
    const none = render([])
    expect(none.html).not.toContain('<p style="margin:0 0 16px"></p>')
    expect(none.text).not.toContain('{{')
  })

  it('flags merge fields it cannot fill', () => {
    expect(unknownTokens('Hi {{firstName}}', markdownToTiptap('{{first_name}} {{schedule_link}}'))).toEqual(['firstName', 'schedule_link'])
  })

  it('keeps link targets in the plain-text version', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the RFP', marks: [{ type: 'link', attrs: { href: 'https://x.test/rfp' } }] }] }] }
    expect(tiptapToEmailText(doc)).toBe('the RFP (https://x.test/rfp)')
  })
})

// ── Audiences ────────────────────────────────────────────────────────────────

function participant(over: Record<string, unknown>) {
  return {
    id: 'p', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', minor: true,
    emergency_contact_first_name: 'Pat', emergency_contact_last_name: 'Lee', emergency_contact_email: 'pat@example.com',
    paid: true, docusign: 'completed', ...over,
  }
}

function group(over: Record<string, unknown>, participants: ReturnType<typeof participant>[]) {
  return {
    registrationId: 'reg', type: 'individual', status: 'confirmed', groupLabel: null, teacherEmail: null, teacherFirstName: null,
    invoiceRequested: false, invoicePaidAt: null, memberPaysIndividually: false, payLinkSendable: false, participants, ...over,
  }
}

const roster = (...groups: ReturnType<typeof group>[]) => ({ groups, summary: {} }) as unknown as Roster
const noPay = () => null

describe('buildRecipients', () => {
  it('emails a parent of two children once, naming both', () => {
    const r = roster(
      group({ registrationId: 'r1' }, [participant({ id: 'p1', first_name: 'Luke', email: 'luke@example.com', emergency_contact_email: 'JT@example.com' })]),
      group({ registrationId: 'r2' }, [participant({ id: 'p2', first_name: 'Lily', email: 'lily@example.com', emergency_contact_email: 'jt@example.com' })]),
    )
    const { recipients } = buildRecipients(r, [], ['guardians'], noPay)
    expect(recipients).toHaveLength(1)
    expect(recipients[0]).toMatchObject({ email: 'jt@example.com', roles: ['guardian'], participantNames: ['Luke', 'Lily'], isParticipant: false })
  })

  it('treats only minors’ emergency contacts as parents', () => {
    const r = roster(group({}, [participant({ minor: false })]))
    expect(buildRecipients(r, [], ['guardians'], noPay).recipients).toEqual([])
  })

  it('outstanding DocuSign reaches the participant and parent and lists the resend set', () => {
    const r = roster(group({}, [participant({ id: 'p1', docusign: 'outstanding' }), participant({ id: 'p2', email: 'b@example.com', emergency_contact_email: 'c@example.com' })]))
    const out = buildRecipients(r, [], ['docusign_outstanding'], noPay)
    expect(out.recipients.map((x) => x.email).sort()).toEqual(['pat@example.com', 'sam@example.com'])
    expect(out.docusignParticipantIds).toEqual(['p1'])
  })

  it('a group paid in one go chases only the teacher, with the group pay link', () => {
    const r = roster(group(
      { type: 'group', registrationId: 'g1', teacherEmail: 'teach@example.com', teacherFirstName: 'Ms K', payLinkSendable: true },
      [participant({ id: 'p1', paid: false }), participant({ id: 'p2', paid: false, email: 'x@example.com' })],
    ))
    const out = buildRecipients(r, [], ['payment_outstanding'], () => 'https://pay/g1')
    expect(out.recipients).toHaveLength(1)
    expect(out.recipients[0]).toMatchObject({
      email: 'teach@example.com', firstName: 'Ms K', roles: ['teacher'],
      payments: [{ participantName: 'your group', payUrl: 'https://pay/g1', method: 'link' }],
    })
  })

  it('an individual registration chases the participant and parent with the pay link', () => {
    const r = roster(group({ payLinkSendable: true }, [participant({ paid: false })]))
    const out = buildRecipients(r, [], ['payment_outstanding'], () => 'https://pay/r')
    expect(out.recipients.map((x) => x.email).sort()).toEqual(['pat@example.com', 'sam@example.com'])
    expect(out.recipients.every((x) => x.payments[0]?.payUrl === 'https://pay/r')).toBe(true)
  })

  it('mentors are volunteers plus event managers', () => {
    const out = buildRecipients(roster(), [
      { email: 'Vol@example.com', firstName: 'Pauline', lastName: 'D', role: 'volunteer' },
      { email: 'em@example.com', firstName: 'Em', lastName: 'M', role: 'event_manager' },
    ], ['mentors'], noPay)
    expect(out.recipients.map((x) => [x.email, x.roles[0]])).toEqual([['em@example.com', 'event_manager'], ['vol@example.com', 'volunteer']])
  })

  it('a student whose address is also the parent’s is greeted as the student', () => {
    const r = roster(group({}, [participant({ email: 'fam@example.com', emergency_contact_email: 'fam@example.com' })]))
    const [only] = buildRecipients(r, [], ['guardians', 'participants'], noPay).recipients
    expect(only).toMatchObject({ firstName: 'Sam', isParticipant: true, roles: ['participant', 'guardian'] })
  })
})

describe('attachAgreementLines', () => {
  it('matches signers to recipients by address, names whose form it is, and lists the Stellr signing participants', () => {
    const r = roster(group({}, [
      participant({ id: 'p1', first_name: 'Luke', email: 'luke@example.com', emergency_contact_email: 'jt@example.com', docusign: 'outstanding' }),
      participant({ id: 'p2', first_name: 'Lily', email: 'lily@example.com', emergency_contact_email: 'jt@example.com', docusign: 'outstanding' }),
    ]))
    const { recipients } = buildRecipients(r, [], ['docusign_outstanding'], noPay)
    const names: Record<string, string> = { p1: 'Luke', p2: 'Lily' }
    const native = attachAgreementLines(recipients, [
      { participantId: 'p1', provider: 'native', email: 'JT@example.com', own: false, signUrl: 'https://x.test/sign#1', waiting: false },
      { participantId: 'p1', provider: 'native', email: 'luke@example.com', own: true, signUrl: null, waiting: true },
      { participantId: 'p2', provider: 'docusign', email: 'jt@example.com', own: false, signUrl: null, waiting: false },
      { participantId: 'p9', provider: 'native', email: 'stranger@example.com', own: false, signUrl: 'https://x.test/sign#9', waiting: false },
    ], (id) => names[id])

    const parent = recipients.find((x) => x.email === 'jt@example.com')!
    expect(parent.agreements).toEqual([
      { participantName: 'Luke', provider: 'native', signUrl: 'https://x.test/sign#1', waiting: false },
      { participantName: 'Lily', provider: 'docusign', signUrl: null, waiting: false },
    ])
    expect(recipients.find((x) => x.email === 'luke@example.com')!.agreements).toEqual([
      { participantName: 'your', provider: 'native', signUrl: null, waiting: true },
    ])
    // Lily's own address gets nothing: her DocuSign row was not listed for her.
    expect(recipients.find((x) => x.email === 'lily@example.com')!.agreements).toBeUndefined()
    // A signer who is not in this email's audience is never added to it.
    expect(recipients.some((x) => x.email === 'stranger@example.com')).toBe(false)
    expect(native.sort()).toEqual(['p1', 'p9'])
  })
})

describe('schedule', () => {
  it('waits, sends from N days out through the event day, then skips', () => {
    expect(scheduleDecision('2026-10-03', 7, '2026-09-25')).toBe('wait')
    expect(scheduleDecision('2026-10-03', 7, '2026-09-26')).toBe('send')
    expect(scheduleDecision('2026-10-03', 7, '2026-10-03')).toBe('send')
    expect(scheduleDecision('2026-10-03', 7, '2026-10-04')).toBe('skip')
    expect(scheduleDecision(null, 7, '2026-10-01')).toBe('wait')
  })

  it('computes the send date and days to go', () => {
    expect(scheduledSendDate('2026-10-03', 7)).toBe('2026-09-26')
    expect(scheduledSendDate('2026-03-02', 5)).toBe('2026-02-25')
    expect(daysUntil('2026-10-03', '2026-09-28')).toBe(5)
  })
})
