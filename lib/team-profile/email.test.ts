import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: vi.fn(), getEventsForSurveySchedule: vi.fn() }))

const { teamProfileEmailBody, profileOpen } = await import('./store')
const { markdownToTiptap } = await import('@/lib/event-emails/defaults')
const { renderEventEmail, eventMergeVars, recipientMergeVars } = await import('@/lib/event-emails/render')

const event = { slug: 'co-sdc', title: '2027 Colorado SDC', date: '2027-03-06', venue: 'STEM School' }

function render(opts: { returning: boolean; viaGuardian: boolean }) {
  const { subject, body } = teamProfileEmailBody({ ...opts, studentName: 'Lily' })
  return renderEventEmail(
    { subject, body_json: markdownToTiptap(body) },
    {
      ...eventMergeVars(event, '2027-02-01'),
      ...recipientMergeVars({
        email: 'x@example.com',
        firstName: opts.viaGuardian ? 'Tamara' : 'Lily',
        roles: ['participant'],
        participantNames: ['Lily'],
        isParticipant: !opts.viaGuardian,
        payments: [],
        teamProfiles: [{ participantName: opts.viaGuardian ? 'Lily' : 'your', url: 'https://app.example/team-profile/abc' }],
      }),
    },
  )
}

describe('team profile email', () => {
  it('invites a new student with their link and no unfilled merge fields', () => {
    const r = render({ returning: false, viaGuardian: false })
    expect(r.subject).toBe('2027 Colorado SDC: your team profile (about 5 minutes)')
    expect(r.text).toContain('Hi Lily,')
    expect(r.text).toContain('Fill in your team profile here: https://app.example/team-profile/abc')
    expect(r.html).toContain('href="https://app.example/team-profile/abc"')
    expect(r.text + r.html).not.toMatch(/\{\{/)
  })

  it('asks a returning student to check pre-filled answers', () => {
    const r = render({ returning: true, viaGuardian: false })
    expect(r.subject).toBe('2027 Colorado SDC: check your team profile')
    expect(r.text).toContain('answers from last time')
  })

  it('asks a parent to pass the link on', () => {
    const r = render({ returning: false, viaGuardian: true })
    expect(r.text).toContain('Hi Tamara,')
    expect(r.text).toContain('Please pass the link to Lily')
    expect(r.text).toContain('Lily’s team profile: https://app.example/team-profile/abc')
  })
})

describe('profileOpen', () => {
  const at = new Date('2027-03-06T04:00:00Z') // 9pm on the 5th in Denver, 11pm in New York
  it('stays open until the event day begins in the event’s time zone', () => {
    expect(profileOpen({ date: '2027-03-06', timeZone: 'America/Denver', cancelled: false }, at)).toBe(true)
    expect(profileOpen({ date: '2027-03-06', timeZone: 'Europe/London', cancelled: false }, at)).toBe(false)
    expect(profileOpen({ date: null, timeZone: 'America/Denver', cancelled: false }, at)).toBe(true)
    expect(profileOpen({ date: '2027-03-06', timeZone: 'America/Denver', cancelled: true }, at)).toBe(false)
  })
})
