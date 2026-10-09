import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-2: /api/asset-request emails Stellr-branded HTML, from the
// marketing sender, to the submitted address. The submitted name is escaped so
// injected markup can't render.

const { sendEmail, captureLead } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => undefined),
  captureLead: vi.fn(async (_input: unknown) => ({ ok: true, via: 'form' as const, noteLogged: true, warnings: [] })),
}))

vi.mock('@/lib/email', () => ({ sendEmail, MARKETING_FROM: 'Stellr Education <hello@mail.example.org>' }))
vi.mock('@/lib/hubspot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot')>('@/lib/hubspot')
  return { ...actual, captureLead, readHubspotCookie: () => undefined }
})
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/asset-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => vi.clearAllMocks())

const INJECTION = 'there,</p><a/href=https://evil.example>Confirm</a><div/style=display:none>'

describe('asset-request email escaping (PUB-2)', () => {
  it('escapes the submitted name in the HTML body', async () => {
    await post({ name: INJECTION, email: 'parent@victim.com', asset: 'student-rfp' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<a/href')
    expect(html).not.toContain('<div/style=display:none>')
    expect(html).toContain('&lt;a/href')
  })
})
