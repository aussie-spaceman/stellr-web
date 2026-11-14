import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CompanyPlan, PlanningStudent } from '@/lib/team-profile/assign'

// Team profiles panel: the Overridden pill and the override buttons. The
// network is faked; the panel only has to send the right request and refresh.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const { default: EventTeamProfiles } = await import('./EventTeamProfiles')

const student = (participantId: string, firstName: string, over: Partial<PlanningStudent> = {}): PlanningStudent => ({
  participantId,
  memberId: null,
  firstName,
  lastName: 'Test',
  school: null,
  grade: null,
  gender: null,
  age: null,
  ethnicity: [],
  experience: 0,
  registrationId: `r-${participantId}`,
  isGroup: false,
  companyId: null,
  companyNumber: null,
  locked: false,
  status: 'sent',
  lastSentAt: '2026-10-20T12:00:00Z',
  sendCount: 1,
  lastSendError: null,
  submittedAt: null,
  overridden: null,
  answers: null,
  teammates: [],
  suggestedCompany: null,
  ...over,
})

const plan: CompanyPlan = {
  companies: [{ id: 'c1', number: 1, name: null }],
  students: [
    student('p1', 'Ava', { status: 'submitted', submittedAt: '2026-10-21T12:00:00Z' }),
    student('p2', 'Ben', { overridden: { at: '2026-10-30T18:00:00Z', by: 'Event Manager' } }),
    student('p3', 'Cal'),
    student('p4', 'Dee', { status: 'waiting', lastSentAt: null, sendCount: 0 }),
  ],
}

const row = (name: RegExp) => screen.getByRole('row', { name })
let requests: { url: string; body: unknown }[] = []

beforeEach(() => {
  requests = []
  refresh.mockClear()
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ ok: true, overridden: 2 }), { status: 200 })
  })
  vi.stubGlobal('confirm', () => true)
})

describe('EventTeamProfiles — override', () => {
  it('shows Overridden in place of the status, with the status and who beneath', () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={plan} />)
    const ben = row(/Ben Test/)
    expect(within(ben).getByText('Overridden')).toBeInTheDocument()
    expect(within(ben).getByText('Sent · Oct 20')).toBeInTheDocument()
    expect(within(ben).getByText('by Event Manager · Oct 30')).toBeInTheDocument()
    expect(within(ben).getByRole('button', { name: 'Undo override' })).toBeInTheDocument()
    expect(within(row(/Cal Test/)).getByText('Sent')).toBeInTheDocument()
    expect(screen.getByText('1 submitted · 1 overridden · 1 sent · 0 not sent · 1 waiting on forms')).toBeInTheDocument()
  })

  it('offers no override once a student has submitted', () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={plan} />)
    const ava = row(/Ava Test/)
    expect(within(ava).getByText('Submitted')).toBeInTheDocument()
    expect(within(ava).queryByRole('button', { name: /override/i })).toBeNull()
  })

  it('overrides one student, waiting on forms included', async () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={plan} />)
    await userEvent.click(within(row(/Dee Test/)).getByRole('button', { name: 'Override' }))
    expect(requests).toEqual([
      { url: '/api/admin/events/nevada/companies', body: { action: 'override', participantId: 'p4', overridden: true } },
    ])
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByText('Auto-Assign will place Dee Test without a team profile.')).toBeInTheDocument()
  })

  it('undoes an override', async () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={plan} />)
    await userEvent.click(within(row(/Ben Test/)).getByRole('button', { name: 'Undo override' }))
    expect(requests[0].body).toEqual({ action: 'override', participantId: 'p2', overridden: false })
  })

  it('overrides everyone not submitted in one go', async () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={plan} />)
    await userEvent.click(screen.getByRole('button', { name: 'Override all not submitted' }))
    expect(requests[0].body).toEqual({ action: 'override_all' })
    expect(screen.getByText('Overrode 2 students. Run Auto-Assign to place them.')).toBeInTheDocument()
  })

  it('still counts overridden students for the team profile email', async () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={plan} />)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    await userEvent.click(screen.getByRole('button', { name: 'Send to everyone not submitted' }))
    // Ben (overridden) and Cal are sent; Dee is waiting on forms.
    expect(confirm).toHaveBeenCalledWith('Send the team profile to 2 students who haven’t submitted one yet?')
  })
})

// roster-grade-display.4: the grade goes through displayGrade, so both stored
// shapes ("10" and "grade_10") read "Grade 10" and a college enum reads as its
// form label, not the raw value.
describe('EventTeamProfiles — grade', () => {
  const withGrades: CompanyPlan = {
    companies: [],
    students: [
      student('g1', 'Eli', { grade: '10' }),
      student('g2', 'Fay', { grade: 'grade_11' }),
      student('g3', 'Gus', { grade: 'college_freshman' }),
      student('g4', 'Hal', { grade: 'Grade 9' }),
      student('g5', 'Ivy', { grade: null }),
    ],
  }

  it.each([
    [/Eli Test/, 'Grade 10'],
    [/Fay Test/, 'Grade 11'],
    [/Gus Test/, 'College Freshman'],
    [/Hal Test/, 'Grade 9'],
  ])('%s shows %s', (name, label) => {
    render(<EventTeamProfiles eventSlug="nevada" plan={withGrades} />)
    expect(within(row(name)).getByText(label)).toBeInTheDocument()
  })

  it('shows no grade, and no separator, when there is none', () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={withGrades} />)
    expect(within(row(/Ivy Test/)).queryByText(/Grade|·/)).toBeNull()
  })

  it('keeps an unrecognised value as it is', () => {
    render(<EventTeamProfiles eventSlug="nevada" plan={{ companies: [], students: [student('g6', 'Jo', { grade: 'Homeschool' })] }} />)
    expect(within(row(/Jo Test/)).getByText('Homeschool')).toBeInTheDocument()
  })
})
