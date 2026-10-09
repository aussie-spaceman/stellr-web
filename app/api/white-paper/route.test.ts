import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-2: /api/white-paper emails Stellr-branded HTML, from the
// DKIM-aligned marketing sender, to the address the submitter typed. The
// submitted name must be escaped so injected markup renders as inert text
// rather than a phishing lure.

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
    new Request('https://www.stellreducation.org/api/white-paper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => vi.clearAllMocks())

// Whitespace-free so the whole payload lands in `firstName` (the route uses the
// first whitespace-delimited token) — the finding's point is that HTML needs no
// spaces, so token-splitting is no defence.
const INJECTION = 'there,</p><h2>Action&nbsp;required</h2><a/href=https://evil.example>Confirm</a><div/style=display:none>'

describe('white-paper email escaping (PUB-2)', () => {
  it('escapes the submitted name in the HTML body and renders no live markup', async () => {
    await post({ name: INJECTION, email: 'parent@victim.com' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<a/href')
    expect(html).not.toContain('</p><h2>')
    expect(html).not.toContain('<div/style=display:none>')
    expect(html).toContain('&lt;a/href')
    expect(html).toContain('&lt;h2&gt;')
  })

  it('leaves a clean name intact', async () => {
    await post({ name: 'Jordan Blake', email: 'jordan@example.com' })
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).toContain('Hi Jordan,')
  })
})
