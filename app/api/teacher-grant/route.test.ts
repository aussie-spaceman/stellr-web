import { describe, it, expect, vi, beforeEach } from 'vitest'

const { captureLead, sendEmail, upsertMember, linkMembersToSchoolByName, autoGrantBaseMembership } = vi.hoisted(() => ({
  upsertMember: vi.fn(async (_db: unknown, _input: unknown): Promise<string | null> => 'member-1'),
  linkMembersToSchoolByName: vi.fn(async () => undefined),
  autoGrantBaseMembership: vi.fn(async () => undefined),
  captureLead: vi.fn(async (_input: unknown) => ({
    ok: true,
    via: 'form' as const,
    noteLogged: true,
    warnings: [],
  })),
  sendEmail: vi.fn(async (_opts: unknown) => undefined),
}))

vi.mock('@/lib/hubspot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot')>('@/lib/hubspot')
  return { ...actual, captureLead, readHubspotCookie: () => undefined }
})
vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/member-sync', () => ({ upsertMember }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership }))

const { POST } = await import('./route')

const VALID = {
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'dana@lincolnhigh.edu',
  phone: '555-0100',
  schoolName: 'Lincoln High School',
  schoolCity: 'Reno',
  schoolState: 'nv',
  subjects: 'Physics, Engineering',
  yearsTeaching: '8',
  dateOfBirth: '1988-04-12',
  gender: 'Female',
  plannedActivities: 'both',
  expectedStudents: '12',
  priorStellr: 'no',
  motivation:
    'I have been looking for a way to give my seniors a real engineering problem to work on together.',
  referralSource: 'A colleague',
  consent: true,
  acknowledgePayment: true,
}

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/teacher-grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const lastCapture = () => captureLead.mock.calls.at(-1)?.[0] as any
const lastEmail = () => sendEmail.mock.calls.at(-1)?.[0] as any
const lastMember = () => upsertMember.mock.calls.at(-1)?.[1] as any

beforeEach(() => {
  captureLead.mockClear()
  sendEmail.mockClear()
  upsertMember.mockClear()
  upsertMember.mockResolvedValue('member-1')
  linkMembersToSchoolByName.mockClear()
  autoGrantBaseMembership.mockClear()
})

describe('POST /api/teacher-grant', () => {
  it('accepts a valid application and captures it as teacher_grant', async () => {
    const res = await post(VALID)

    expect(res.status).toBe(200)
    expect(captureLead).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)

    const arg = lastCapture()
    expect(arg.source).toBe('teacher_grant')
    expect(arg.email).toBe('dana@lincolnhigh.edu')
    expect(arg.properties.grant_planned_activities).toBe('Both')
    expect(arg.properties.grant_prior_stellr).toBe('No')
    expect(arg.properties.grant_status).toBe('Applied')
    expect(arg.properties.grant_expected_students).toBe('12')
  })

  it('segments every applicant as a high school teacher without asking', async () => {
    await post(VALID)
    const props = lastCapture().properties
    // High-school-only eligibility means the demographic is known up front.
    expect(props.event_demographic).toBe('High School')
    expect(props.jobtitle).toBe('Teacher')
    // Superseded by event_demographic — a second copy is a second thing to sync.
    expect(props.grant_grade_levels).toBeUndefined()
  })

  it('registers the applicant as an adult teacher member, matched on email', async () => {
    await post(VALID)

    expect(upsertMember).toHaveBeenCalledTimes(1)
    const member = lastMember()
    expect(member.email).toBe('dana@lincolnhigh.edu')
    expect(member.age_bracket).toBe('adult')
    expect(member.event_role).toBe('teacher')
    expect(member.date_of_birth).toBe('1988-04-12')
    expect(member.gender).toBe('Female')
  })

  it('links the member to their school and grants the free Educator tier', async () => {
    await post(VALID)

    expect(linkMembersToSchoolByName).toHaveBeenCalledTimes(1)
    const [, memberIds, school] = linkMembersToSchoolByName.mock.calls.at(-1) as any[]
    expect(memberIds).toEqual(['member-1'])
    expect(school.name).toBe('Lincoln High School')
    expect(school.address_state).toBe('NV')

    expect(autoGrantBaseMembership).toHaveBeenCalledWith({}, 'member-1')
  })

  it('still accepts the application when member registration fails', async () => {
    upsertMember.mockRejectedValueOnce(new Error('db down'))

    const res = await post(VALID)

    // The application already reached the inbox and HubSpot; losing the
    // membership grant must not lose the application.
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(captureLead).toHaveBeenCalledTimes(1)
  })

  it('does not attempt school linking when no member id came back', async () => {
    upsertMember.mockResolvedValueOnce(null)

    const res = await post(VALID)

    expect(res.status).toBe(200)
    expect(linkMembersToSchoolByName).not.toHaveBeenCalled()
    expect(autoGrantBaseMembership).not.toHaveBeenCalled()
  })

  it('writes the school to the standard `school` property, never `company`', async () => {
    await post(VALID)
    const props = lastCapture().properties
    expect(props.school).toBe('Lincoln High School')
    expect(props.company).toBeUndefined()
  })

  it('normalises the state to upper case', async () => {
    await post(VALID)
    expect(lastCapture().properties.state).toBe('NV')
  })

  it('stamps the application date at UTC midnight, not the current instant', async () => {
    await post(VALID)
    const value = Number(lastCapture().properties.grant_application_date)
    expect(Number.isInteger(value)).toBe(true)
    // HubSpot rejects a date property that is not exactly UTC midnight.
    expect(value % 86_400_000).toBe(0)
  })

  it('ignores a program year supplied by the client', async () => {
    await post({ ...VALID, programYear: '2028' })
    expect(lastCapture().properties.grant_program_year).toBe('2027')
  })

  it('replies to the applicant, not to the site', async () => {
    await post(VALID)
    expect(lastEmail().replyTo).toBe('dana@lincolnhigh.edu')
    expect(lastEmail().to).toBe('hello@stellreducation.org')
  })

  it('escapes markup submitted in free text', async () => {
    await post({ ...VALID, schoolName: '<script>alert(1)</script>' })
    expect(lastEmail().html).not.toContain('<script>')
    expect(lastEmail().html).toContain('&lt;script&gt;')
  })

  it('accepts silently and does nothing when the honeypot is filled', async () => {
    const res = await post({ ...VALID, website: 'http://spam.example' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(captureLead).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reports every invalid field at once', async () => {
    const res = await post({ ...VALID, email: 'not-an-email', motivation: 'too short' })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fields).toContain('email')
    expect(body.fields).toContain('motivation')
    expect(captureLead).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown activity', { plannedActivities: 'workshop' }, 'plannedActivities'],
    ['the retired "competition" value', { plannedActivities: 'competition' }, 'plannedActivities'],
    ['a non-numeric student count', { expectedStudents: 'about ten' }, 'expectedStudents'],
    ['a missing contact consent', { consent: false }, 'consent'],
    ['an unacknowledged payment term', { acknowledgePayment: false }, 'acknowledgePayment'],
    ['a non-US state', { schoolState: 'Ontario' }, 'schoolState'],
    ['a missing date of birth', { dateOfBirth: '' }, 'dateOfBirth'],
    ['an unknown gender value', { gender: 'Wizard' }, 'gender'],
  ])('rejects %s', async (_label, override, field) => {
    const res = await post({ ...VALID, ...override })

    expect(res.status).toBe(400)
    expect((await res.json()).fields).toContain(field)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(upsertMember).not.toHaveBeenCalled()
  })
})
