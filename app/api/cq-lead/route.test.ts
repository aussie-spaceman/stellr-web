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
  firstName: 'Test',
  lastName: 'Teacher',
  email: 'teacher@example.edu',
  school: 'Example High',
  subject: 'Physics',
  studentsBand: '26-75',
  theme: 'space',
  grantInterest: true,
  consent: true,
  pageSlug: 'mncose26',
  utm_source: 'mncose26',
  utm_medium: 'flyer',
  utm_campaign: 'classroom-qualifier',
}

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/cq-lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

type Captured = { source: string; properties: Record<string, string>; firstName: string; lastName: string }
const captured = () => captureLead.mock.calls[0][0] as Captured

beforeEach(() => {
  captureLead.mockClear()
  captureLead.mockResolvedValue({ ok: true, via: 'form', noteLogged: true, warnings: [] })
})

describe('POST /api/cq-lead', () => {
  it('captures a valid request as a Classroom Qualifier lead', async () => {
    const res = await post(VALID)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, stored: true })
    expect(captured().source).toBe('classroom_qualifier')
    expect(captured()).toMatchObject({ firstName: 'Test', lastName: 'Teacher' })
  })

  it('writes the handover properties, lead source page and UTMs', async () => {
    await post(VALID)
    expect(captured().properties).toMatchObject({
      school: 'Example High',
      lp_source_page: 'mncose26',
      lp_audience: 'classroom_qualifier_teacher',
      lp_program_interest: 'classroom-qualifier',
      cq_theme: 'space',
      cq_window: '2026-27',
      cq_teacher_grant_interest: 'true',
      cq_students_band: '26-75',
      cq_course_subject: 'Physics',
      lp_utm_source: 'mncose26',
      lp_utm_medium: 'flyer',
      lp_utm_campaign: 'classroom-qualifier',
    })
  })

  it('never writes an empty UTM over a stored one', async () => {
    await post({ ...VALID, utm_content: undefined, utm_term: undefined })
    expect(captured().properties).not.toHaveProperty('lp_utm_content')
    expect(captured().properties).not.toHaveProperty('lp_utm_term')
  })

  it('reports a failed write honestly', async () => {
    captureLead.mockResolvedValue({ ok: false, via: 'none', noteLogged: false, warnings: [] })
    const res = await post(VALID)
    await expect(res.json()).resolves.toEqual({ ok: false, stored: false })
  })

  it('refuses pages it does not publish, including booking-call pages', async () => {
    expect((await post({ ...VALID, pageSlug: 'not-a-page' })).status).toBe(400)
    expect((await post({ ...VALID, pageSlug: 'first-robotics-teachers' })).status).toBe(400)
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('requires consent and the teacher fields', async () => {
    expect((await post({ ...VALID, consent: false })).status).toBe(400)
    expect((await post({ ...VALID, school: '' })).status).toBe(400)
    expect((await post({ ...VALID, studentsBand: '500' })).status).toBe(400)
    expect(captureLead).not.toHaveBeenCalled()
  })
})
