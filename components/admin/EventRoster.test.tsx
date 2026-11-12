import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { RecordLinksProvider } from '@/components/admin/RecordLinks'
import EventRoster from './EventRoster'
import type { EventRosterData, RosterGroup, RosterParticipant } from '@/lib/event-admin'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))

// The row actions have their own fetches and dialogs; stand-ins keep this test
// about where they render and how they are sized. Two of them put className on
// a wrapping <span>, as the real components do.
vi.mock('@/components/admin/DeleteEntityButton', () => ({
  DeleteEntityButton: ({ label, className }: { label?: string; className?: string }) => (
    <button type="button" className={className}>{label ?? 'Delete'}</button>
  ),
}))
vi.mock('@/components/admin/CorrectSignerEmailButton', () => ({
  CorrectSignerEmailButton: ({ className }: { className?: string }) => (
    <button type="button" className={`text-xs ${className ?? ''}`}>Correct email</button>
  ),
}))
vi.mock('@/components/admin/SendPayLinkButton', () => ({
  SendPayLinkButton: ({ className }: { className?: string }) => (
    <span className={`inline-flex ${className ?? ''}`}><button type="button">Send pay link</button></span>
  ),
}))
vi.mock('@/components/admin/ReissueDocusignButton', () => ({
  ReissueDocusignButton: ({ className }: { className?: string }) => (
    <span className={`inline-flex ${className ?? ''}`}><button type="button">Reissue DocuSign</button></span>
  ),
}))

const participant: RosterParticipant = {
  id: 'p-1',
  first_name: 'Avery',
  last_name: 'Test',
  email: 'avery@example.com',
  grade: '11',
  gender: null,
  date_of_birth: null,
  t_shirt_size: 'M',
  school_name: 'Example High School',
  event_role: 'participant',
  dietary_requirements: [],
  health_conditions: null,
  company_id: null,
  checked_in_at: null,
  minor: true,
  emergency_contact_name: null,
  emergency_contact_first_name: null,
  emergency_contact_last_name: null,
  emergency_contact_email: null,
  emergency_contact_phone: null,
  emergency_contact_relationship: null,
  paid: false,
  docusign: 'outstanding',
  payment_pill: 'link_unpaid',
  docusign_pill: 'issued',
  docusign_label: 'Issued',
  docusign_detail: 'Awaiting the parent/guardian',
  correctable_agreement_id: 'agr-1',
  compliance_pill: 'not_required',
  refund_detail: null,
  member_id: 'mem-1',
}

const group: RosterGroup = {
  registrationId: 'reg-1',
  type: 'individual',
  status: 'pending',
  groupLabel: null,
  teacherName: null,
  teacherMemberId: null,
  schoolName: null,
  teacherEmail: null,
  teacherFirstName: null,
  invoiceRequested: false,
  invoicePaidAt: null,
  memberPaysIndividually: false,
  payLinkSendable: true,
  scholarship: null,
  participants: [participant],
}

const roster: EventRosterData = {
  groups: [group],
  scholarshipOffers: [],
  summary: {
    totalParticipants: 1,
    groupParticipants: 0,
    individualParticipants: 1,
    groupRegistrations: 0,
    individualRegistrations: 1,
    dietary: [],
    healthIssues: [],
    outstandingPayments: 1,
    outstandingDocusigns: 1,
    checkedIn: 0,
    scholarshipHolders: 0,
  },
}

function renderRoster({ open = true, links = false }: { open?: boolean; links?: boolean } = {}) {
  const result = render(
    <RecordLinksProvider enabled={links}>
      <EventRoster
        roster={roster}
        exportHref="/api/admin/events/demo/roster.csv"
        eventSlug="demo"
        companies={[{ id: 'co-1', number: 1, name: 'Apollo', count: 0 }]}
        isAdmin
      />
    </RecordLinksProvider>,
  )
  // Registrations start folded to their summary line; most tests read the rows.
  if (open) fireEvent.click(screen.getByRole('button', { name: /^Individual: Avery Test/ }))
  return result
}

// jsdom applies no CSS, so both layouts are in the document: the card list
// (lg:hidden) and the table (hidden lg:block). Each is found by its role.
function card() {
  return screen.getByRole('heading', { name: /^Avery Test/ }).closest('li') as HTMLElement
}

describe('EventRoster: mobile review N3', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  })

  it('below lg, renders one card per participant with the key fields as a definition list', () => {
    renderRoster()
    const c = card()
    expect(c.closest('ul')).toHaveClass('lg:hidden')
    const school = within(c).getByText('School')
    expect(school.tagName).toBe('DT')
    expect(school.nextElementSibling).toHaveTextContent('Example High School')
    expect(within(c).getByText('Awaiting the parent/guardian')).toBeInTheDocument()
    expect(within(c).getByText('Registered')).toBeInTheDocument()
  })

  it('gives every card action a 44px target', () => {
    renderRoster()
    const c = card()
    expect(within(c).getByRole('button', { name: 'Delete Registration' })).toHaveClass('min-h-11', 'text-danger')
    expect(within(c).getByRole('button', { name: 'Correct email' })).toHaveClass('min-h-11')
    // Send pay link / Reissue: the size is set on the wrapper, for the button inside it.
    expect(within(c).getByRole('button', { name: 'Send pay link' }).parentElement).toHaveClass('[&>button]:min-h-11')
    expect(within(c).getByRole('button', { name: 'Reissue DocuSign' }).parentElement).toHaveClass('[&>button]:min-h-11')
  })

  it('from lg, shows the table in a scrollable region with the name column held in place', () => {
    renderRoster()
    const region = screen.getByRole('region', { name: 'Individual registration: Avery Test' })
    expect(region).toHaveClass('hidden', 'lg:block', 'overflow-x-auto')
    expect(region).toHaveAttribute('tabindex', '0')
    const nameCell = within(region).getByText('Avery Test').closest('td')
    expect(nameCell).toHaveClass('sticky', 'left-0')
    // The table's actions keep the compact link style.
    expect(within(region).getByRole('button', { name: 'Delete Registration' })).not.toHaveClass('min-h-11')
  })

  it('moves a participant to a company through the same handler from the card and the table', async () => {
    renderRoster()
    const [inCard, inTable] = screen.getAllByRole('combobox', { name: 'Company for Avery Test' })
    expect(card()).toContainElement(inCard)

    fireEvent.change(inCard, { target: { value: 'co-1' } })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    fireEvent.change(inTable, { target: { value: 'co-1' } })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))

    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(2)
    for (const [url, init] of calls) {
      expect(url).toBe('/api/admin/events/demo/companies')
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        action: 'move',
        participantId: 'p-1',
        companyId: 'co-1',
      })
    }
  })

  it('folds each registration to a summary line, remembered per browser', () => {
    window.localStorage.clear()
    renderRoster({ open: false })
    const toggle = screen.getByRole('button', { name: /^Individual: Avery Test/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('1 participant · 1 unpaid · 1 DocuSign open')
    expect(screen.queryByRole('heading', { name: 'Avery Test' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(window.localStorage.getItem('stellr.collapse.event.demo.groups:reg-1')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('links names and schools to their records for admins, opening a new tab', () => {
    renderRoster({ links: true })
    const name = within(card()).getByRole('link', { name: /Avery Test/ })
    expect(name).toHaveAttribute('href', '/admin/members/mem-1')
    expect(name).toHaveAttribute('target', '_blank')
    // No school id resolved: plain text, never a guessed link.
    expect(within(card()).queryByRole('link', { name: /Example High School/ })).not.toBeInTheDocument()
  })

  it("folds a group to its label and counts, and links the group's teacher and school", () => {
    const schoolGroup: RosterGroup = {
      ...group,
      registrationId: 'reg-g',
      type: 'group',
      groupLabel: 'Pat Teacher — Example High School',
      teacherName: 'Pat Teacher',
      teacherMemberId: 'mem-t',
      schoolName: 'Example High School',
      schoolId: 'sch-1',
      payLinkSendable: false,
      participants: [{ ...participant, id: 'p-2', paid: true, school_id: 'sch-1' }],
    }
    render(
      <RecordLinksProvider enabled>
        <EventRoster
          roster={{ ...roster, groups: [schoolGroup] }}
          exportHref="/x.csv"
          eventSlug="demo"
          companies={[]}
          isAdmin
        />
      </RecordLinksProvider>,
    )
    const toggle = screen.getByRole('button', { name: /^Group: Pat Teacher — Example High School/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('1 participant · 1 DocuSign open')
    // Folded: the body is in the DOM but hidden, so ask for hidden elements.
    expect(screen.getByRole('link', { name: /^Pat Teacher/, hidden: true })).toHaveAttribute('href', '/admin/members/mem-t')
    const schools = screen.getAllByRole('link', { name: /^Example High School/, hidden: true })
    expect(schools.length).toBeGreaterThan(0)
    for (const a of schools) expect(a).toHaveAttribute('href', '/admin/schools/sch-1')
  })

  it('shows plain names when record links are off (event managers)', () => {
    renderRoster({ links: false })
    expect(within(card()).queryByRole('link', { name: /Avery Test/ })).not.toBeInTheDocument()
  })
})
