import { describe, it, expect, vi } from 'vitest'

// render.ts reaches lib/community (server-only) through lib/email-render.
vi.mock('@/lib/community', () => ({
  tiptapToPlainText: () => '',
  RESOURCES_BUCKET: 'community-resources',
}))
// audiences.ts reaches Clerk and the database only inside its async loaders.
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn() }))

const { awardMergeVars, winnerNames } = await import('./awards')
const { eventMergeVars, recipientMergeVars, renderEventEmail, unknownTokens } = await import('./render')
const { attachCredentialLines, buildRecipients } = await import('./audiences')
const { markdownToTiptap } = await import('./defaults')
const { cleanTemplateName, templateFieldsFromEmail } = await import('./templates')

type Roster = Parameters<typeof buildRecipients>[0]

const EVENT = { slug: 'nevada-space-design-challenge', title: 'Nevada Space Design Challenge', venue: 'A School' }

// ── Awards ──────────────────────────────────────────────────────────────────

const w = (awardType: string, participantId: string, firstName: string, lastName = 'X', companyId: string | null = 'c2') =>
  ({ awardType, participantId, firstName, lastName, companyId }) as Parameters<typeof awardMergeVars>[0][number]

describe('award merge fields', () => {
  it('lists first names, sorted, with "and"', () => {
    expect(winnerNames([w('anita_gale', 'p1', 'Taylor'), w('anita_gale', 'p2', 'Jordan'), w('anita_gale', 'p3', 'Avery')])).toBe('Avery, Jordan and Taylor')
    expect(winnerNames([w('anita_gale', 'p1', 'Taylor')])).toBe('Taylor')
    expect(winnerNames([])).toBe('')
  })

  it('adds a last initial only where two winners share a first name', () => {
    expect(winnerNames([w('a', 'p1', 'Robin', 'Smith'), w('a', 'p2', 'Robin', 'Tran'), w('a', 'p3', 'Alex', 'Ng')]))
      .toBe('Alex, Robin S. and Robin T.')
  })

  it('names the champion company, the winners per award, and all individual winners once each', () => {
    const vars = awardMergeVars(
      [
        w('overall_champion', 'p1', 'Avery'), w('overall_champion', 'p2', 'Quinn'),
        w('norm_chaffee', 'p1', 'Avery'), w('norm_chaffee', 'p2', 'Quinn'),
        w('anita_gale', 'p3', 'Jordan', 'X', 'c1'), w('anita_gale', 'p4', 'Morgan'),
        w('dick_edwards', 'p5', 'Taylor', 'X', 'c1'), w('dick_edwards', 'p6', 'Casey'),
      ],
      [{ id: 'c1', number: 1, name: 'Nova Labs' }, { id: 'c2', number: 2, name: 'Orbital Works' }],
    )
    expect(vars).toEqual({
      champion_company: 'Orbital Works',
      individual_award_winners: 'Avery, Casey, Jordan, Morgan, Quinn and Taylor',
      norm_chaffee_winners: 'Avery and Quinn',
      anita_gale_winners: 'Jordan and Morgan',
      dick_edwards_winners: 'Casey and Taylor',
    })
  })

  it('falls back to "Company N" for an unnamed champion company, and empty with no awards', () => {
    expect(awardMergeVars([w('overall_champion', 'p1', 'Avery', 'X', 'c3')], [{ id: 'c3', number: 3, name: null }]).champion_company).toBe('Company 3')
    expect(Object.values(awardMergeVars([], [])).every((v) => v === '')).toBe(true)
  })
})

// ── Feedback link and rendering ──────────────────────────────────────────────

describe('post-event fields', () => {
  it('are all known to the engine', () => {
    const body = markdownToTiptap(
      '{{champion_company}} {{individual_award_winners}} {{norm_chaffee_winners}} {{anita_gale_winners}} {{dick_edwards_winners}} {{feedback_link}} {{certificate_links}} {{credential_links}}',
    )
    expect(unknownTokens('', body)).toEqual([])
  })

  it('links the event survey page', () => {
    expect(eventMergeVars(EVENT).feedback_link).toMatch(/\/survey\/event\/nevada-space-design-challenge$/)
    const out = renderEventEmail({ subject: 'x', body_json: markdownToTiptap('Feedback: {{feedback_link}}') }, eventMergeVars(EVENT))
    expect(out.html).toMatch(/<a href="https:\/\/[^"]+\/survey\/event\/nevada-space-design-challenge"/)
  })

  it('renders certificate and credential links, naming whose they are when not all the recipient’s own', () => {
    const body = { subject: 'x', body_json: markdownToTiptap('{{certificate_links}}\n\n{{credential_links}}') }
    const line = (participantName: string, label: string, n: string) =>
      ({ participantName, label, certificateUrl: `https://app.test/api/credentials/${n}/certificate?k=t`, credentialUrl: `https://www.test/credentials/${n}?k=v` })

    const own = renderEventEmail(body, {
      ...eventMergeVars(EVENT),
      ...recipientMergeVars({ email: 's@x.test', firstName: 'Sam', roles: [], isParticipant: true, participantNames: [], payments: [],
        credentials: [line('your', 'Certificate of Participation', 'A')] }),
    })
    expect(own.text).toContain('Certificate of Participation: https://app.test/api/credentials/A/certificate?k=t')
    expect(own.html).toContain('<a href="https://app.test/api/credentials/A/certificate?k=t"')
    expect(own.html).toContain('>Download PDF</a>')
    expect(own.html).toContain('>View credential</a>')

    const parent = renderEventEmail(body, {
      ...eventMergeVars(EVENT),
      ...recipientMergeVars({ email: 'p@x.test', firstName: 'Pat', roles: [], isParticipant: false, participantNames: ['Sam', 'Alex'], payments: [],
        credentials: [line('Sam', 'Certificate of Participation', 'A'), line('Alex', 'Anita Gale Award for Creative Vision', 'B')] }),
    })
    expect(parent.text).toContain('Sam’s Certificate of Participation: https://app.test/api/credentials/A/certificate?k=t')
    expect(parent.text).toContain('Alex’s Anita Gale Award for Creative Vision: https://www.test/credentials/B?k=v')
  })

  it('leaves no empty paragraph when a recipient has no credentials', () => {
    const out = renderEventEmail({ subject: 'x', body_json: markdownToTiptap('Hi\n\n{{certificate_links}}') }, {
      ...eventMergeVars(EVENT),
      ...recipientMergeVars({ email: 'p@x.test', firstName: 'Pat', roles: [], isParticipant: false, participantNames: [], payments: [] }),
    })
    expect(out.html).not.toContain('<p style="margin:0 0 16px"></p>')
  })
})

// ── Credential lines per recipient ───────────────────────────────────────────

function participant(over: Record<string, unknown>) {
  return {
    id: 'p', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', minor: true,
    emergency_contact_first_name: 'Pat', emergency_contact_last_name: 'Lee', emergency_contact_email: 'pat@example.com',
    paid: true, docusign: 'completed', ...over,
  }
}
const roster = (participants: ReturnType<typeof participant>[]) =>
  ({
    groups: [{ registrationId: 'r', type: 'individual', status: 'confirmed', invoiceRequested: false, memberPaysIndividually: false, payLinkSendable: false, participants }],
    summary: {},
  }) as unknown as Roster

const cred = (id: string, award_type: string | null, participant_id: string | null, member_id: string | null = null) =>
  ({ id, number: `STL-${id}`, award_type, award: null, title: `Award — Event`, participant_id, member_id })

describe('attachCredentialLines', () => {
  const r = roster([
    participant({ id: 'p1', first_name: 'Sam', email: 'sam@example.com' }),
    participant({ id: 'p2', first_name: 'Alex', email: 'alex@example.com' }),
  ])
  const mentors = [{ email: 'mentor@example.com', firstName: 'Max', lastName: 'M', role: 'volunteer' as const, key: 'v.m9', memberId: 'm9' }]

  it('gives a student their own, a parent each child’s (participation first), and a mentor theirs', () => {
    const { recipients } = buildRecipients(r, mentors, ['participants', 'guardians', 'mentors'], () => null)
    attachCredentialLines(
      recipients,
      r,
      [cred('2', 'anita_gale', 'p2'), cred('1', 'participation', 'p1'), cred('3', 'participation', 'p2'), cred('4', 'mentor', null, 'm1')],
      new Map([['m1', 'Mentor@example.com']]),
      false,
    )
    const by = (e: string) => recipients.find((x) => x.email === e)!
    expect(by('sam@example.com').credentials).toEqual([
      { participantName: 'your', label: 'Certificate of Participation', certificateUrl: '[certificate link]', credentialUrl: '[credential link]' },
    ])
    expect(by('pat@example.com').credentials!.map((c) => `${c.participantName}: ${c.label}`)).toEqual([
      'Sam: Certificate of Participation',
      'Alex: Certificate of Participation',
      'Alex: Anita Gale Award for Creative Vision',
    ])
    expect(by('mentor@example.com').credentials!.map((c) => c.label)).toEqual(['Certificate of Appreciation'])
  })

  it('adds nothing for someone not in this email’s audience', () => {
    const { recipients } = buildRecipients(r, [], ['guardians'], () => null)
    attachCredentialLines(recipients, r, [cred('1', 'participation', 'p1')], new Map(), false)
    expect(recipients.map((x) => x.email)).toEqual(['pat@example.com'])
    expect(recipients[0].credentials).toHaveLength(1)
  })
})

// ── Saved templates ──────────────────────────────────────────────────────────

describe('saved templates', () => {
  it('copy the reusable part of an email, never its attachments', () => {
    const fields = templateFieldsFromEmail({
      id: 'e', event_slug: 'nevada-space-design-challenge', name: 'Close out', template_key: 'blank', audiences: ['participants'],
      subject: 'Thanks', body_json: { type: 'doc' }, attachments: [{ path: 'x', filename: 'x.pdf', size: 1, contentType: 'application/pdf' }],
      resend_docusign: false, schedule_days_before: null, status: 'sent', created_by: null, sent_at: null, created_at: '', updated_at: '',
    })
    expect(fields).toEqual({
      audiences: ['participants'], subject: 'Thanks', body_json: { type: 'doc' }, resend_docusign: false,
      schedule_days_before: null, source_event_slug: 'nevada-space-design-challenge',
    })
    expect(fields).not.toHaveProperty('attachments')
  })

  it('tidy the name, and refuse an empty one', () => {
    expect(cleanTemplateName('  Close   out  ')).toBe('Close out')
    expect(cleanTemplateName('   ')).toBeNull()
    expect(cleanTemplateName(42)).toBeNull()
  })
})
