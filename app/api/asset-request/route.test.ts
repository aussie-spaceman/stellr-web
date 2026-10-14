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
// The emailed link is signed (lib/gated-download-link.ts); give it a test secret.
vi.stubEnv('ASSET_LINK_SECRET', 'test-asset-link-secret-0123456789abcdef')

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
    await post({ name: INJECTION, email: 'parent@victim.com', asset: 'space-rfp-2026' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<a/href')
    expect(html).not.toContain('<div/style=display:none>')
    expect(html).toContain('&lt;a/href')
  })
})

describe('asset-request gate (the full file only ever goes out by email)', () => {
  it('emails a signed, expiring download link and returns no file location', async () => {
    const res = await post({ name: 'Jordan Blake', email: 'jordan@example.com', asset: 'mission-handbook-2026' })
    expect(res.status).toBe(200)
    const body = JSON.stringify(await res.json())
    const { html, text } = sendEmail.mock.calls[0][0] as { html: string; text: string }
    expect(text).toMatch(/\/api\/asset-request\/download\?a=mission-handbook-2026&e=\d+&s=[A-Za-z0-9_-]{43}/)
    for (const out of [html, text, body]) {
      expect(out).not.toMatch(/blob\.vercel-storage\.com|supabase\.co|gated-downloads|\.pdf/)
    }
  })

  it('refuses an unknown or retired asset key', async () => {
    const res = await post({ email: 'jordan@example.com', asset: 'student-rfp' })
    expect(res.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reports a failed send rather than claiming success', async () => {
    sendEmail.mockRejectedValueOnce(new Error('smtp down'))
    const res = await post({ email: 'jordan@example.com', asset: 'space-rfp-2026' })
    expect(res.status).toBe(502)
  })
})
