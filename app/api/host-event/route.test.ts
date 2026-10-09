import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-2 / HTML-injection cluster: the public Host An Event form
// interpolates its fields into a Stellr-branded HTML email to staff. Every
// field is escaped so a submission can't inject markup.

const { sendEmail, captureLead } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => undefined),
  captureLead: vi.fn(async (_input: unknown) => ({ ok: true, via: 'form' as const, noteLogged: true, warnings: [] })),
}))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/hubspot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot')>('@/lib/hubspot')
  return { ...actual, captureLead, readHubspotCookie: () => undefined }
})
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

beforeEach(() => vi.clearAllMocks())

const XSS = '<img src=x onerror=alert(1)>'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/host-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID = {
  firstName: 'Dana', lastName: 'Reyes', email: 'dana@example.com', phone: '555-0100',
  companySchool: 'Acme HS', venueCapacity: '200', preferredTiming: 'Spring', preferredDuration: '1 day',
}

describe('host-event email escaping (PUB-2)', () => {
  it('escapes every submitted field in the HTML body', async () => {
    await post({ ...VALID, companySchool: XSS, firstName: XSS, preferredTiming: XSS })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})
