import { describe, it, expect, vi } from 'vitest'
import type { MemberDigest } from './admin-digest'

vi.mock('@/lib/sanity', () => ({ getEventsBySlugs: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))

const { renderDigestEmail } = await import('./admin-digest-email')
const { digestWindow } = await import('./admin-digest')

const NOW = new Date('2026-10-30T18:30:00Z')
const z = () => ({ current: 0, previous: 0 })

function digest(over: Partial<MemberDigest['outstanding']> = {}): MemberDigest {
  return {
    window: digestWindow(7, NOW),
    generatedAt: NOW.toISOString(),
    growth: {
      newMembers: { current: 3, previous: 1, byRole: { participant: 2, mentor: 1 }, people: [
        { memberId: 'm1', name: 'Kid Student', minor: true, detail: 'Participant', at: '2026-10-29T00:00:00Z' },
      ] },
      registrations: { ...z(), participants: 0, items: [] },
    },
    left: {
      deactivated: { current: 1, previous: 0, people: [{ memberId: 'm2', name: 'Gone Adult', minor: false, detail: 'Mentor', at: '2026-10-28T00:00:00Z' }] },
      lapsed: { ...z(), people: [] },
      unsubscribed: { ...z(), people: [] },
      withdrew: { ...z(), items: [] },
    },
    engagement: { activeMembers: { current: 4, previous: 6 }, posts: z(), comments: z(), reactions: z(), chatMessages: z(), spaceJoins: z(), topSpaces: [] },
    mentoring: {
      coachingRequests: { ...z(), byStatus: {}, people: [] },
      cohortJoins: { ...z(), people: [] },
      volunteerSignups: { ...z(), people: [] },
      newMentors: { ...z(), people: [] },
    },
    outstanding: {
      awaitingSignature: [],
      paperworkGaps: [],
      verifications: { review: [], inProcess: 0, missing: 0 },
      payments: [],
      paymentsTotalCents: 0,
      queues: { coaching: [], scholarships: [], privacy: [], deletions: [] },
      ...over,
    },
    errors: [],
  }
}

const render = (d: MemberDigest) => renderDigestEmail(d, { appUrl: 'https://app.example.org', now: NOW })

describe('renderDigestEmail', () => {
  it('reports the week as counts with the comparison, and names no one outside the outstanding list', () => {
    const { subject, html, text } = render(digest())
    expect(subject).toBe('Stellr weekly digest: 3 new members, 0 items waiting on you')
    expect(text).toContain('- New members: 3 (+2 on last week) - 2 participants, 1 mentor')
    expect(text).toContain('- Members active in spaces: 4 (−2 on last week)')
    for (const body of [html, text]) {
      expect(body).not.toContain('Kid Student')
      expect(body).not.toContain('Gone Adult')
    }
    expect(text).toContain('Nothing is waiting on you.')
  })

  it('lists a minor’s consent form under the guardian, never the student', () => {
    const { html, text } = render(digest({
      awaitingSignature: [
        { id: 'a1', signerName: 'Pat Parent', minorName: 'Kid Student', eventTitle: 'Nevada SDC', sentAt: '2026-10-20T00:00:00Z', reminders: 2, memberId: null },
        { id: 'a2', signerName: 'Solo Kid', minorName: 'Solo Kid', eventTitle: 'Nevada SDC', sentAt: '2026-10-25T00:00:00Z', reminders: 0, memberId: null },
      ],
    }))
    expect(text).toContain('- Pat Parent (parent or guardian) - Nevada SDC · waiting 10 days · 2 reminders')
    expect(text).toContain('- A student’s consent form - Nevada SDC · waiting 5 days')
    for (const body of [html, text]) {
      expect(body).not.toContain('Kid Student')
      expect(body).not.toContain('Solo Kid')
    }
  })

  it('names adults on outstanding items but not minors, and leaves possibly-minor queues as counts', () => {
    const { html, text } = render(digest({
      paperworkGaps: [
        { participantId: 'p1', name: 'Minor Name', eventSlug: 'nv', eventTitle: 'Nevada SDC', eventDate: '2026-11-06', reason: 'not_issued', detail: null, since: null, minor: true },
        { participantId: 'p2', name: 'Adult Mentor', eventSlug: 'nv', eventTitle: 'Nevada SDC', eventDate: '2026-11-06', reason: 'declined', detail: null, since: null, minor: false },
      ],
      payments: [
        { key: 'k', kind: 'checkout', who: 'Young Registrant', minor: true, eventSlug: 'nv', eventTitle: 'Nevada SDC', amountCents: 5900, detail: 'Checkout not completed', since: '2026-10-01T00:00:00Z' },
      ],
      paymentsTotalCents: 5900,
      queues: {
        coaching: [{ id: 'c', label: 'Student Asker', detail: 'Rockets', personal: true, at: '2026-10-21T00:00:00Z', href: '/x' }],
        scholarships: [], privacy: [], deletions: [],
      },
    }))
    expect(text).toContain('- A student - Nevada SDC · never sent')
    expect(text).toContain('- Adult Mentor - Nevada SDC · declined')
    expect(text).toContain('- A student · $59 - Nevada SDC · Checkout not completed')
    expect(text).toContain('- 1 coaching request waiting for a coach')
    for (const body of [html, text]) {
      for (const name of ['Minor Name', 'Young Registrant', 'Student Asker']) expect(body).not.toContain(name)
    }
  })

  it('shows at most five per list, with a count of the rest', () => {
    const awaitingSignature = Array.from({ length: 7 }, (_, i) => ({
      id: `a${i}`, signerName: `Signer ${i}`, minorName: null, eventTitle: 'Event', sentAt: '2026-10-25T00:00:00Z', reminders: 0, memberId: null,
    }))
    const { text, subject } = render(digest({ awaitingSignature }))
    expect(subject).toContain('7 items waiting on you')
    expect(text).toContain('Signer 4')
    expect(text).not.toContain('Signer 5')
    expect(text).toContain('and 2 more')
  })

  it('escapes names in the HTML and warns when a section failed to load', () => {
    const d = digest({ verifications: { review: [{ memberId: 'm', name: '<b>Ann</b>', email: null, eventRole: 'teacher', state: 'awaiting_verification', detail: null, license: null, check: null }], inProcess: 1, missing: 2 } })
    d.errors = ['Payments']
    const { html, text } = render(d)
    expect(html).toContain('&lt;b&gt;Ann&lt;/b&gt;')
    expect(html).not.toContain('<b>Ann</b>')
    expect(text).toContain('1 background check in progress; 2 adults with no valid clearance on file')
    expect(text).toContain("Some sections didn't load and may read low: Payments.")
  })
})

describe('the Staff section (phase 4)', () => {
  it('lists waiting and ending grants, over-readers and exports, and the quarterly review when due', () => {
    const d: MemberDigest = {
      ...digest(),
      staff: {
        pending: [{ memberId: 'm1', name: 'Ana B', missing: ['mfa', 'training'], since: '2026-10-20T00:00:00Z' }],
        expiringSoon: [{ memberId: 'm2', name: 'Cy D', expiresAt: '2026-12-01T00:00:00Z' }],
        exports: { total: 3, byRole: { staff: 2, admin: 1 } },
        unusualViewers: [{ name: 'Gil H', role: 'staff', views: 140 }],
        quarterlyReview: [{ memberId: 'm2', name: 'Cy D', expiresAt: '2026-12-01T00:00:00Z' }],
      },
    }
    const { html, text } = render(d)
    expect(html).toContain('Staff access')
    expect(text).toContain('Ana B: Staff waiting - still needs mfa, training')
    expect(text).toContain('Cy D: Staff ends')
    expect(text).toContain('Gil H (staff) opened 140 minors’ records this week')
    expect(text).toContain('3 exports this week - 2 by staff, 1 by admin')
    expect(html).toContain('Quarterly Staff access review (1)')
  })
  it('is left out when there is nothing to say', () => {
    const { html } = render({ ...digest(), staff: { pending: [], expiringSoon: [], exports: { total: 0, byRole: {} }, unusualViewers: [], quarterlyReview: null } })
    expect(html).not.toContain('Staff access')
  })
})

// resend-quota-outbox.5 and B14b: mail that may not be going out.
describe('mail needing a look', () => {
  const failedEmail = {
    key: 'email' as const, label: 'Email outbox', state: 'failed' as const, windowHours: 8,
    lastRunAt: '2026-10-30T18:05:00Z', lastSuccessAt: '2026-10-28T12:05:00Z',
    detail: 'Mail has been waiting more than two days. 7 waiting, the oldest for 50 hours',
  }
  const healthySigning = {
    key: 'signing' as const, label: 'Signing invitations outbox', state: 'ok' as const, windowHours: 30,
    lastRunAt: '2026-10-30T09:15:00Z', lastSuccessAt: '2026-10-30T09:15:00Z', detail: null,
  }

  it('a stuck outbox: says it failed, when it last worked, and the counts', () => {
    const { html, text } = render({ ...digest(), outboxes: [failedEmail, healthySigning] })
    expect(text).toContain('MAIL NEEDING A LOOK')
    expect(text).toContain('- Email outbox: the latest run failed (Fri, Oct 30, 12:05 PM MDT). Last successful run Wed, Oct 28, 6:05 AM MDT. Mail has been waiting more than two days. 7 waiting, the oldest for 50 hours.')
    expect(html).toContain('Mail needing a look')
    expect(text).not.toContain('Signing invitations outbox')
  })

  it('an overdue outbox with no success on record', () => {
    const { text } = render({ ...digest(), outboxes: [{ ...failedEmail, state: 'overdue', lastSuccessAt: null, detail: null }] })
    expect(text).toContain('- Email outbox: no successful run in the last 8 hours. No successful run on record.')
  })

  it('healthy outboxes and no held invitations: nothing is said', () => {
    for (const d of [digest(), { ...digest(), outboxes: [healthySigning], heldSigningInvites: 0 }, { ...digest(), heldSigningInvites: null }]) {
      const { html, text } = render(d)
      expect(text).not.toContain('MAIL NEEDING A LOOK')
      expect(html).not.toContain('Mail needing a look')
    }
  })

  it('held signing invitations: a count only, when non-zero', () => {
    expect(render({ ...digest(), heldSigningInvites: 3 }).text).toContain(
      '- 3 signing invitations for other organisers are held: their organisers have no email sender set up yet, so nothing has been sent.',
    )
    expect(render({ ...digest(), heldSigningInvites: 1 }).text).toContain(
      '- 1 signing invitation for other organisers is held: its organiser has no email sender set up yet, so nothing has been sent.',
    )
  })
})
