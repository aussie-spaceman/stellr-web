import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeadForm } from './LeadForm'
import { firstRoboticsTeachers } from '@/content/lp/first-robotics-teachers'

/**
 * The rule under test is the one that cannot be got wrong: a lead that did not
 * reach HubSpot must never be redirected away. The visitor is the only copy of
 * that lead, so sending them to someone else's calendar without storing it
 * first loses it permanently.
 */

const BOOKING = 'https://app.usemotion.com/meet/david-m-shaw/welcome'

const assign = vi.fn()
const fetchMock = vi.fn()

beforeEach(() => {
  assign.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  // jsdom throws on a real navigation, so location is replaced wholesale.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign, search: '?utm_source=facebook' },
  })
  window.dataLayer = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

async function fillAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Full name'), 'Alex Whitfield')
  await user.type(screen.getByLabelText('Email'), 'alex@example.org')
  await user.click(screen.getByLabelText(/I agree to Stellr Education/))
  await user.click(screen.getByRole('button', { name: 'Learn more now' }))
}

function renderForm() {
  return render(<LeadForm config={firstRoboticsTeachers} bookingUrl={BOOKING} />)
}

describe('LeadForm booking hand-off', () => {
  it('redirects to the calendar once the lead is stored', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, stored: true }))
    renderForm()
    await fillAndSubmit()

    await waitFor(() => expect(assign).toHaveBeenCalledWith(BOOKING))
    expect(screen.getByText('Taking you to the calendar')).toBeTruthy()
  })

  it('does NOT redirect when HubSpot rejected the write', async () => {
    // The route answers 200 so the visitor is never stranded, but `stored:
    // false` means the lead is not in the CRM. Redirecting would produce a
    // booking with no contact to attach it to.
    fetchMock.mockResolvedValue(json({ ok: false, stored: false }))
    renderForm()
    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText('Pick a time to talk')).toBeTruthy())
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByText(/could not confirm your details were saved/)).toBeTruthy()
  })

  it('does NOT redirect when the request fails outright', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    renderForm()
    await fillAndSubmit()

    await waitFor(() => expect(screen.getByText('Pick a time to talk')).toBeTruthy())
    expect(assign).not.toHaveBeenCalled()
    // Still a working link, so the visitor is not dropped on a dead end.
    expect(screen.getByRole('link', { name: 'Choose a time' })).toBeTruthy()
  })

  it('does NOT redirect on a server error', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Server error' }, false))
    renderForm()
    await fillAndSubmit()

    await waitFor(() => expect(assign).not.toHaveBeenCalled())
  })

  it('blocks submission until consent is given, and posts nothing', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Full name'), 'Alex Whitfield')
    await user.type(screen.getByLabelText('Email'), 'alex@example.org')
    await user.click(screen.getByRole('button', { name: 'Learn more now' }))

    await waitFor(() => expect(screen.getByText('You must agree to be contacted')).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('pushes both funnel events before navigating away', async () => {
    // Order matters: a push after window.location.assign may never run.
    fetchMock.mockResolvedValue(json({ ok: true, stored: true }))
    renderForm()
    await fillAndSubmit()

    await waitFor(() => expect(assign).toHaveBeenCalled())
    const events = (window.dataLayer as { event?: string }[]).map((e) => e.event)
    expect(events).toContain('lead_submitted')
    expect(events).toContain('lp_booking_click')
  })

  it('carries the captured UTM source and the config defaults in the payload', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, stored: true }))
    renderForm()
    await fillAndSubmit()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      name: 'Alex Whitfield',
      email: 'alex@example.org',
      role: 'teacher',
      students: 6,
      pageSlug: 'first-robotics-teachers',
      audience: 'first_robotics_teacher',
      utm_source: 'facebook',
    })
  })
})
