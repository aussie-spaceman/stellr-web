import { describe, it, expect, vi, beforeEach } from 'vitest'

const { captureLead } = vi.hoisted(() => ({
  captureLead: vi.fn(
    async (_input: unknown): Promise<{
      ok: boolean
      via: 'form' | 'contacts-api' | 'none'
      noteLogged: boolean
      warnings: string[]
    }> => ({ ok: true, via: 'form', noteLogged: true, warnings: [] }),
  ),
}))

vi.mock('@/lib/hubspot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot')>('@/lib/hubspot')
  return { ...actual, captureLead, readHubspotCookie: () => 'hutk-abc' }
})
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

const VALID = {
  name: 'Alex Whitfield',
  email: 'alex@school.org',
  role: 'teacher' as const,
  students: 6,
  consent: true as const,
  pageSlug: 'first-robotics-teachers',
  audience: 'first_robotics_teacher',
}

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/lp-lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  captureLead.mockClear()
  captureLead.mockResolvedValue({ ok: true, via: 'form', noteLogged: true, warnings: [] })
})

describe('POST /api/lp-lead', () => {
  it('captures a valid submission and reports it stored', async () => {
    const res = await post(VALID)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, stored: true })
    expect(captureLead).toHaveBeenCalledTimes(1)
  })

  it('splits the single name field on the first space', async () => {
    // One field is asked for because two costs completions, and HubSpot needs
    // the pair. Everything after the first space is the surname, so
    // "van der Berg" survives intact.
    await post({ ...VALID, name: 'Alex van der Berg' })
    expect(captureLead.mock.calls[0][0]).toMatchObject({
      firstName: 'Alex',
      lastName: 'van der Berg',
    })
  })

  it('sends no lastName for a single-word name', async () => {
    await post({ ...VALID, name: 'Prince' })
    const input = captureLead.mock.calls[0][0] as { firstName: string; lastName?: string }
    expect(input.firstName).toBe('Prince')
    expect(input.lastName).toBeUndefined()
  })

  it('maps the audience, page and role onto HubSpot properties', async () => {
    await post(VALID)
    const input = captureLead.mock.calls[0][0] as {
      source: string
      properties: Record<string, string>
      context: { hutk?: string; pageUri?: string }
    }
    expect(input.source).toBe('landing_page')
    expect(input.properties).toMatchObject({
      stellr_role: 'teacher',
      lp_audience: 'first_robotics_teacher',
      lp_source_page: 'first-robotics-teachers',
      lp_program_interest: 'space-design-competition',
      expected_student_count: '6',
    })
    // Without the hutk the submission arrives unattributed and the per-page
    // source reporting these pages exist to produce does not work.
    expect(input.context.hutk).toBe('hutk-abc')
    expect(input.context.pageUri).toContain('/lp/first-robotics-teachers')
  })

  it('omits a blank student count rather than sending zero', async () => {
    // HubSpot stores what it is given, and a 0 there reads as "brings no one".
    const { students, ...noStudents } = VALID
    void students
    await post(noStudents)
    const input = captureLead.mock.calls[0][0] as { properties: Record<string, string> }
    expect(input.properties).not.toHaveProperty('expected_student_count')
  })

  it('omits blank UTM values instead of writing empty strings', async () => {
    // An empty string would overwrite a real UTM captured on an earlier visit.
    await post({ ...VALID, utm_source: 'facebook', utm_medium: '' })
    const input = captureLead.mock.calls[0][0] as { properties: Record<string, string> }
    expect(input.properties.lp_utm_source).toBe('facebook')
    expect(input.properties).not.toHaveProperty('lp_utm_medium')
  })

  it('rejects a submission without consent', async () => {
    const res = await post({ ...VALID, consent: false })
    expect(res.status).toBe(400)
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('rejects a malformed email', async () => {
    const res = await post({ ...VALID, email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('rejects a page slug we do not publish', async () => {
    // Otherwise the lp_source_page dropdown fills with whatever anyone POSTs
    // and the per-page reporting becomes noise.
    const res = await post({ ...VALID, pageSlug: 'made-up-page' })
    expect(res.status).toBe(400)
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('trusts the registry over the client for the audience', async () => {
    await post({ ...VALID, audience: 'something_else' })
    const input = captureLead.mock.calls[0][0] as { properties: Record<string, string> }
    expect(input.properties.lp_audience).toBe('first_robotics_teacher')
  })

  it('still answers 200 when HubSpot rejects the write, flagged as not stored', async () => {
    // The visitor must reach the booking calendar either way — a booked call we
    // reconcile by hand beats a dead end. captureLead has already dead-lettered.
    captureLead.mockResolvedValue({ ok: false, via: 'none', noteLogged: false, warnings: ['x'] })
    const res = await post(VALID)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: false, stored: false })
  })
})
