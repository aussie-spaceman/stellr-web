import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-2 / HTML-injection cluster: the public Join The Network form
// interpolates its fields into a Stellr-branded HTML email to staff. Every
// field is escaped so a submission can't inject markup.

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async (_opts: unknown) => undefined) }))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

beforeEach(() => vi.clearAllMocks())

const XSS = '<img src=x onerror=alert(1)>'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/join-network', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID = {
  firstName: 'Dana', lastName: 'Reyes', email: 'dana@example.com', phone: '555-0100',
  companyName: 'Acme', whatYouDo: 'robotics', reason: 'sponsor',
}

describe('join-network email escaping (PUB-2)', () => {
  it('escapes every submitted field in the HTML body', async () => {
    await post({ ...VALID, companyName: XSS, whatYouDo: XSS, firstName: XSS })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})
