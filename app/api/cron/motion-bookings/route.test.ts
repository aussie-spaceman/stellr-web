import { describe, it, expect, vi, beforeEach } from 'vitest'

const { listUpdatedEvents, getContactByEmail, upsertContact, createNote } = vi.hoisted(() => ({
  listUpdatedEvents: vi.fn(),
  getContactByEmail: vi.fn(),
  upsertContact: vi.fn(),
  createNote: vi.fn(),
}))

vi.mock('@/lib/google-calendar', () => ({
  isCalendarConfigured: () => true,
  listUpdatedEvents,
}))
vi.mock('@/lib/hubspot', () => ({ getContactByEmail, upsertContact, createNote }))

const { GET } = await import('./route')

const ORGANISER = 'david.shaw@stellreducation.org'

function bookingEvent(guest = 'alex@school.org') {
  return {
    id: 'evt1',
    summary: 'Welcome To Stellr Events with David',
    status: 'confirmed',
    start: { dateTime: '2026-09-10T15:30:00Z' },
    organizer: { email: ORGANISER },
    attendees: [{ email: ORGANISER, organizer: true }, { email: guest }],
  }
}

function call(url = 'https://www.stellreducation.org/api/cron/motion-bookings', auth = 'Bearer test-secret') {
  return GET(new Request(url, { headers: { authorization: auth } }))
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret')
  vi.stubEnv('HUBSPOT_ACCESS_TOKEN', 'token')
  vi.stubEnv('MOTION_CALENDAR_ID', 'bookings@stellreducation.org')
  vi.stubEnv('MOTION_BOOKING_TITLE', 'Stellr')
  listUpdatedEvents.mockReset().mockResolvedValue([bookingEvent()])
  getContactByEmail
    .mockReset()
    .mockResolvedValue({ id: '101', properties: { lp_audience: 'first_robotics_teacher' } })
  upsertContact.mockReset().mockResolvedValue({ ok: true })
  createNote.mockReset().mockResolvedValue({ ok: true })
})

describe('GET /api/cron/motion-bookings', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await call(undefined, 'Bearer wrong')
    expect(res.status).toBe(401)
    expect(listUpdatedEvents).not.toHaveBeenCalled()
  })

  it('stamps lp_call_booked and writes a note', async () => {
    const res = await call()
    await expect(res.json()).resolves.toMatchObject({ booked: 1, stampedNow: ['alex@school.org'] })
    expect(upsertContact).toHaveBeenCalledWith({
      email: 'alex@school.org',
      properties: { lp_call_booked: 'true' },
    })
    expect(createNote).toHaveBeenCalledWith('101', expect.stringContaining('2026-09-10 15:30 UTC'))
  })

  it('never creates a contact for an unknown attendee', async () => {
    // Otherwise any meeting on this calendar could invent a landing-page lead.
    getContactByEmail.mockResolvedValue(null)
    const res = await call()
    await expect(res.json()).resolves.toMatchObject({ booked: 0, notInHubspot: 1 })
    expect(upsertContact).not.toHaveBeenCalled()
    expect(createNote).not.toHaveBeenCalled()
  })

  it('never stamps a contact who did not come from a landing page', async () => {
    // The decisive guard. With the needle set to "Stellr" this calendar matched
    // 212 of 250 events — partners, colleagues, curriculum calls — and any of
    // them who is a HubSpot contact would otherwise be marked as having booked
    // a landing-page call.
    getContactByEmail.mockResolvedValue({ id: '404', properties: {} })
    const res = await call()
    await expect(res.json()).resolves.toMatchObject({ booked: 0, notLandingPageLead: 1 })
    expect(upsertContact).not.toHaveBeenCalled()
    expect(createNote).not.toHaveBeenCalled()
  })

  it('is idempotent — an already-stamped contact gets no second note', async () => {
    // This job re-reads the same 72 hours every hour, so a re-run must be inert.
    getContactByEmail.mockResolvedValue({
      id: '101',
      properties: { lp_audience: 'homeschool', lp_call_booked: 'true' },
    })
    const res = await call()
    await expect(res.json()).resolves.toMatchObject({ booked: 0, alreadyBooked: 1 })
    expect(createNote).not.toHaveBeenCalled()
  })

  it('ignores an unrelated meeting on the same calendar', async () => {
    listUpdatedEvents.mockResolvedValue([{ ...bookingEvent(), summary: 'Dentist' }])
    const res = await call()
    await expect(res.json()).resolves.toMatchObject({ considered: 0, booked: 0 })
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('ignores a cancelled booking', async () => {
    listUpdatedEvents.mockResolvedValue([{ ...bookingEvent(), status: 'cancelled' }])
    await expect((await call()).json()).resolves.toMatchObject({ booked: 0 })
    expect(upsertContact).not.toHaveBeenCalled()
  })

  it('does not write a note when the property write failed', async () => {
    // A note saying "booked" beside a property that says otherwise is worse
    // than neither.
    upsertContact.mockResolvedValue({ ok: false })
    const res = await call()
    await expect(res.json()).resolves.toMatchObject({ booked: 0, warnings: ['write-failed:alex@school.org'] })
    expect(createNote).not.toHaveBeenCalled()
  })

  it('honours ?hours= for a backfill', async () => {
    // The first run should reach back over the whole campaign, not three days.
    const res = await call('https://x/api/cron/motion-bookings?hours=2000')
    await expect(res.json()).resolves.toMatchObject({ lookbackHours: 2000 })
  })

  it('caps an absurd ?hours= rather than reading the entire calendar', async () => {
    const res = await call('https://x/api/cron/motion-bookings?hours=99999')
    await expect(res.json()).resolves.toMatchObject({ lookbackHours: 9600 })
  })

  it('defaults the lookback when ?hours= is nonsense', async () => {
    const res = await call('https://x/api/cron/motion-bookings?hours=abc')
    await expect(res.json()).resolves.toMatchObject({ lookbackHours: 72 })
  })

  it('skips quietly when HubSpot is not configured', async () => {
    // An hourly alarm for something simply not wired yet trains people to
    // ignore alarms.
    vi.stubEnv('HUBSPOT_ACCESS_TOKEN', '')
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ booked: 0 })
  })

  it('reports a calendar failure with the likely cause', async () => {
    listUpdatedEvents.mockRejectedValue(new Error('Request had insufficient authentication scopes'))
    const res = await call()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.hint).toContain('shared with GOOGLE_SERVICE_ACCOUNT_EMAIL')
  })
})
