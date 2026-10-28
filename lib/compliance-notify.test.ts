// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// Clearance notices for adults taking part in an event. What matters: an
// uncleared adult is told by email AND in-app regardless of their email
// preference; a cleared one (or a minor) is never told; each (member, event,
// reason) goes out once; and the reminder sweep picks up events 0–14 days away,
// a day the cron missed included, and nothing else.

const { sendEmail, getEventBySlug } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: { to: string; subject: string; html: string; text: string }) => ({ id: 'e1' })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<{ title?: string; date?: string | null } | null> => null),
}))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
// The real logActivity resolves the actor through Clerk; the notice always
// passes its own actor, so write the row the way lib/activity-log does.
vi.mock('@/lib/activity-log', () => ({
  logActivity: async (
    input: { memberId: string; category: string; action: string; summary: string; metadata?: Record<string, unknown>; actorType?: string },
    db: { from: (t: string) => { insert: (row: unknown) => Promise<unknown> } },
  ) => {
    await db.from('member_activity_log').insert({
      member_id: input.memberId,
      actor_type: input.actorType ?? 'system',
      category: input.category,
      action: input.action,
      summary: input.summary,
      metadata: input.metadata ?? {},
    })
  },
}))

const { notifyClearanceRequired, remindUnclearedAdults, clearanceNoticeEmail } = await import('./compliance-notify')

const NOW = new Date('2026-10-28T18:00:00Z') // 28 Oct in Mountain time
const ADULT = '1983-02-10'
const MINOR = '2012-01-01'

const verifiedLicense = (over: Record<string, unknown> = {}) => ({
  id: 'l1', license_number: 'T-1', licensing_state: 'UT', expiry_date: '2028-06-30',
  verified_at: '2026-09-01T00:00:00Z', verified_label: 'Staff', document_path: 'm1/lic.png',
  updated_at: '2026-09-01T00:00:00Z', ...over,
})
const passedCheck = (over: Record<string, unknown> = {}) => ({
  id: 'c1', status: 'passed', result: 'clear', assessment: null, includes_canceled: false,
  provider_report_ref: null, ordered_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-05T00:00:00Z',
  expires_at: '2029-01-05T00:00:00Z', report_pdf_url: null, adjudicated_at: null,
  adjudication_outcome: null, adjudicated_label: null, adjudication_notes: null, provider_adjudication: null,
  ...over,
})
const member = (id: string, over: Record<string, unknown> = {}) => ({
  id, email: `${id}@example.com`, first_name: 'Ada', event_role: 'teacher', date_of_birth: ADULT,
  member_teacher_licenses: [], member_background_checks: [], ...over,
})

const input = (over: Record<string, unknown> = {}) => ({
  memberId: 'm1', eventSlug: 'utah-sdc', eventTitle: 'Utah SDC', eventDate: '2026-11-11',
  reason: 'registered' as const, ...over,
})

let db: FakeDb
const notices = () => db.table('member_activity_log').filter((r) => r.action === 'clearance_notice_sent')

beforeEach(() => {
  sendEmail.mockClear()
  sendEmail.mockImplementation(async () => ({ id: 'e1' }))
  getEventBySlug.mockReset()
  getEventBySlug.mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('notifyClearanceRequired', () => {
  it('emails and notifies an uncleared adult, and records the notice', async () => {
    db = fakeSupabase({ members: [member('m1')] })
    const out = await notifyClearanceRequired(db.client, input(), { now: NOW })

    expect(out).toEqual({ sent: true, emailed: true, inApp: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const mail = sendEmail.mock.calls[0][0]
    expect(mail.to).toBe('m1@example.com')
    expect(mail.subject).toBe('Clearance needed for Utah SDC')
    expect(mail.html).toContain('/account?tab=profile#clearance')
    expect(mail.text).toContain('Reply with a copy of your license')

    expect(db.table('community_notifications')).toEqual([
      expect.objectContaining({
        recipient_member_id: 'm1', type: 'action', reference_type: 'compliance', reference_id: 'm1',
      }),
    ])
    expect(notices()).toEqual([
      expect.objectContaining({
        member_id: 'm1', category: 'compliance',
        metadata: expect.objectContaining({ eventSlug: 'utah-sdc', reason: 'registered' }),
      }),
    ])
  })

  it('emails even when the member has turned email notifications off', async () => {
    db = fakeSupabase({
      members: [member('m1')],
      member_notification_prefs: [{ member_id: 'm1', email_enabled: false, inapp_enabled: true }],
    })
    const out = await notifyClearanceRequired(db.client, input(), { now: NOW })
    expect(out).toMatchObject({ sent: true, emailed: true })
  })

  it('sends once per member, event and reason', async () => {
    db = fakeSupabase({ members: [member('m1')] })
    await notifyClearanceRequired(db.client, input(), { now: NOW })
    const again = await notifyClearanceRequired(db.client, input(), { now: NOW })

    expect(again).toEqual({ sent: false, reason: 'already_sent' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(db.table('community_notifications')).toHaveLength(1)

    // A different reason or a different event is a different notice.
    expect(await notifyClearanceRequired(db.client, input({ reason: 'reminder' }), { now: NOW })).toMatchObject({ sent: true })
    expect(await notifyClearanceRequired(db.client, input({ eventSlug: 'nevada-sdc' }), { now: NOW })).toMatchObject({ sent: true })
    expect(sendEmail).toHaveBeenCalledTimes(3)
  })

  it('does nothing for a member cleared by a verified license', async () => {
    db = fakeSupabase({ members: [member('m1', { member_teacher_licenses: [verifiedLicense()] })] })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: false, reason: 'cleared' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(db.table('community_notifications')).toHaveLength(0)
  })

  it('does nothing for a member cleared by a passed background check', async () => {
    db = fakeSupabase({ members: [member('m1', { member_background_checks: [passedCheck()] })] })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: false, reason: 'cleared' })
  })

  it('judges clearance on the event date: a license expiring first does not count', async () => {
    db = fakeSupabase({
      members: [member('m1', { member_teacher_licenses: [verifiedLicense({ expiry_date: '2026-11-01' })] })],
    })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toMatchObject({ sent: true })
  })

  it('does nothing for a minor', async () => {
    db = fakeSupabase({ members: [member('m1', { date_of_birth: MINOR })] })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: false, reason: 'not_required' })
  })

  it('treats a member whose own role is not event-facing as an adult taking part', async () => {
    db = fakeSupabase({ members: [member('m1', { event_role: 'subscriber' })] })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toMatchObject({ sent: true })
  })

  it('leaves it with Stellr when a license and its photo await verification', async () => {
    db = fakeSupabase({
      members: [member('m1', { member_teacher_licenses: [verifiedLicense({ verified_at: null })] })],
    })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: false, reason: 'staff_review' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('still asks for the photo when a license was entered without one', async () => {
    db = fakeSupabase({
      members: [member('m1', { member_teacher_licenses: [verifiedLicense({ verified_at: null, document_path: null })] })],
    })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toMatchObject({ sent: true })
  })

  it('never asks someone not cleared on review to upload a license instead', async () => {
    db = fakeSupabase({
      members: [member('m1', {
        member_background_checks: [passedCheck({
          status: 'referred', adjudicated_at: '2026-10-01T00:00:00Z', adjudication_outcome: 'not_cleared',
        })],
      })],
    })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: false, reason: 'staff_review' })
  })

  it('records nothing when the email fails, so the next attempt sends cleanly', async () => {
    db = fakeSupabase({ members: [member('m1')] })
    sendEmail.mockRejectedValueOnce(new Error('resend down'))
    const out = await notifyClearanceRequired(db.client, input(), { now: NOW })

    expect(out).toEqual({ sent: false, reason: 'error', error: 'resend down' })
    expect(notices()).toHaveLength(0)
    expect(db.table('community_notifications')).toHaveLength(0)
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toMatchObject({ sent: true })
  })

  it('notifies in-app only when there is no email address', async () => {
    db = fakeSupabase({ members: [member('m1', { email: null })] })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: true, emailed: false, inApp: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reports an unknown member rather than throwing', async () => {
    db = fakeSupabase({ members: [] })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toEqual({ sent: false, reason: 'member_not_found' })
  })

  it('returns an error rather than throwing when the database fails', async () => {
    db = fakeSupabase({ members: [member('m1')] }, { failOn: (t) => (t === 'members' ? 'connection reset' : null) })
    expect(await notifyClearanceRequired(db.client, input(), { now: NOW })).toMatchObject({ sent: false, reason: 'error' })
  })
})

describe('clearanceNoticeEmail', () => {
  const base = {
    firstName: 'Ada', eventTitle: 'Utah SDC', eventDate: '2026-11-11', daysAway: 14,
    checkStarted: false, url: 'https://app.example/account?tab=profile#clearance',
  }

  it('says how far away the event is in the reminder', () => {
    const mail = clearanceNoticeEmail({ ...base, reason: 'reminder' })
    expect(mail.subject).toBe('Utah SDC is two weeks away: clearance still needed')
    expect(mail.text).toContain('Utah SDC is two weeks away (November 11, 2026)')
    expect(clearanceNoticeEmail({ ...base, reason: 'reminder', daysAway: 9 }).subject).toContain('is 9 days away')
  })

  it('names the group and date at registration', () => {
    const mail = clearanceNoticeEmail({ ...base, reason: 'registered' })
    expect(mail.text).toContain("You're bringing a group to Utah SDC on November 11, 2026.")
  })

  it('escapes the event title and name in the HTML', () => {
    const mail = clearanceNoticeEmail({
      ...base, reason: 'registered', firstName: '<b>Ada</b>', eventTitle: '<script>x</script> SDC',
    })
    expect(mail.html).not.toContain('<script>x</script>')
    expect(mail.html).toContain('&lt;script&gt;x&lt;/script&gt; SDC')
    expect(mail.html).not.toContain('<b>Ada</b>')
  })

  it('points a member mid-check at finishing it', () => {
    expect(clearanceNoticeEmail({ ...base, reason: 'registered', checkStarted: true }).text).toContain(
      'Already started a background check?',
    )
    expect(clearanceNoticeEmail({ ...base, reason: 'registered' }).text).not.toContain('Already started')
  })
})

describe('remindUnclearedAdults', () => {
  // One registration per event; its teacher participant is member m-<slug>.
  function seed(events: Record<string, string | null>, extra: { members?: object[]; participants?: object[]; registrations?: object[] } = {}) {
    const slugs = Object.keys(events)
    getEventBySlug.mockImplementation(async (slug: string) =>
      slug in events ? { title: `Event ${slug}`, date: events[slug] } : null,
    )
    return fakeSupabase({
      registrations: [
        ...slugs.map((slug) => ({ id: `r-${slug}`, event_slug: slug, event_title: slug, status: 'confirmed', created_at: '2026-09-01T00:00:00Z' })),
        ...(extra.registrations ?? []),
      ],
      participants: [
        ...slugs.map((slug) => ({ id: `p-${slug}`, registration_id: `r-${slug}`, member_id: `m-${slug}`, event_role: 'teacher', date_of_birth: ADULT })),
        ...(extra.participants ?? []),
      ],
      members: [...slugs.map((slug) => member(`m-${slug}`)), ...(extra.members ?? [])],
    })
  }

  it('reminds for events 0–14 days away, and not outside that window', async () => {
    db = seed({
      today: '2026-10-28', fourteen: '2026-11-11', fifteen: '2026-11-12', past: '2026-10-27', ten: '2026-11-07',
    })
    const r = await remindUnclearedAdults(db.client, { now: NOW })

    expect(r).toMatchObject({ events: 5, eventsInWindow: 3, sent: 3, due: 3, failed: 0 })
    const to = sendEmail.mock.calls.map((c) => c[0].to).sort()
    expect(to).toEqual(['m-fourteen@example.com', 'm-ten@example.com', 'm-today@example.com'])
    const subjects = sendEmail.mock.calls.map((c) => c[0].subject)
    expect(subjects).toContain('Event fourteen is two weeks away: clearance still needed')
    expect(subjects).toContain('Event today is today: clearance still needed')
  })

  it('skips an event with no date (Sanity unset) instead of guessing', async () => {
    db = seed({ undated: null })
    const r = await remindUnclearedAdults(db.client, { now: NOW })
    expect(r).toMatchObject({ events: 1, eventsUndated: 1, eventsInWindow: 0, sent: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reminds once: a second run the next day sends nothing new', async () => {
    db = seed({ soon: '2026-11-07' })
    expect(await remindUnclearedAdults(db.client, { now: NOW })).toMatchObject({ sent: 1 })
    const nextDay = new Date('2026-10-29T18:00:00Z')
    expect(await remindUnclearedAdults(db.client, { now: nextDay })).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('still reminds when the registration notice already went out (a different reason)', async () => {
    db = seed({ soon: '2026-11-07' })
    await notifyClearanceRequired(db.client, input({ memberId: 'm-soon', eventSlug: 'soon', reason: 'registered' }), { now: NOW })
    expect(await remindUnclearedAdults(db.client, { now: NOW })).toMatchObject({ sent: 1, alreadySent: 0 })
  })

  it('leaves out cleared adults, students, withdrawn registrations and people without an account', async () => {
    db = seed(
      { soon: '2026-11-07' },
      {
        members: [
          member('cleared', { member_teacher_licenses: [verifiedLicense()] }),
          member('student', { event_role: 'participant', date_of_birth: MINOR }),
          member('withdrawn'),
        ],
        registrations: [{ id: 'r-gone', event_slug: 'soon', status: 'withdrawn', created_at: '2026-09-01T00:00:00Z' }],
        participants: [
          { registration_id: 'r-soon', member_id: 'cleared', event_role: 'mentor', date_of_birth: ADULT },
          { registration_id: 'r-soon', member_id: 'student', event_role: 'participant', date_of_birth: MINOR },
          { registration_id: 'r-soon', member_id: null, event_role: 'adult', date_of_birth: ADULT },
          { registration_id: 'r-gone', member_id: 'withdrawn', event_role: 'teacher', date_of_birth: ADULT },
        ],
      },
    )
    const r = await remindUnclearedAdults(db.client, { now: NOW })
    expect(r).toMatchObject({ uncleared: 1, sent: 1 })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['m-soon@example.com'])
  })

  it('reminds a member once per event even when they appear twice', async () => {
    db = seed(
      { soon: '2026-11-07' },
      {
        registrations: [{ id: 'r-soon-2', event_slug: 'soon', status: 'confirmed', created_at: '2026-09-02T00:00:00Z' }],
        participants: [{ registration_id: 'r-soon-2', member_id: 'm-soon', event_role: 'teacher', date_of_birth: ADULT }],
      },
    )
    expect(await remindUnclearedAdults(db.client, { now: NOW })).toMatchObject({ sent: 1 })
  })

  it('caps the sends per run, soonest event first, and defers the rest', async () => {
    db = seed({ later: '2026-11-10', sooner: '2026-11-01' })
    const r = await remindUnclearedAdults(db.client, { now: NOW, maxSends: 1 })
    expect(r).toMatchObject({ due: 2, sent: 1, deferred: 1 })
    expect(sendEmail.mock.calls[0][0].to).toBe('m-sooner@example.com')

    // The deferred one goes out on the next run.
    expect(await remindUnclearedAdults(db.client, { now: NOW, maxSends: 1 })).toMatchObject({ sent: 1, alreadySent: 1 })
  })

  it('a dry run counts who is due without sending or recording anything', async () => {
    db = seed({ soon: '2026-11-07' })
    const r = await remindUnclearedAdults(db.client, { now: NOW, dryRun: true })
    expect(r).toMatchObject({ dryRun: true, due: 1, sent: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(notices()).toHaveLength(0)
  })
})
