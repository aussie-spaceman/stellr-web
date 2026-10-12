// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// deep review INT-10 / PUB-6: the opt-out must not happen on a GET (K-12 Safe
// Links / Mimecast scanners fetch every URL on delivery and would silently
// unsubscribe teachers). GET shows a confirm page; POST performs the change.
// The echoed member email must be HTML-escaped.

const memberUpdate = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null }))
let memberRow: { id: string; email: string | null } | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: memberRow }) }) }),
      update: (payload: Record<string, unknown>) => {
        memberUpdate(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))
vi.mock('@/lib/hubspot', () => ({ upsertContact: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/waitlist-optout', () => ({ verifyOptOutToken: () => true }))

const { GET, POST } = await import('./route')

const url = (qs: string) => `http://localhost/api/email/unsubscribe${qs}`

beforeEach(() => {
  memberUpdate.mockClear()
  memberRow = { id: 'm1', email: 'teacher@example.org' }
})

describe('member marketing opt-out', () => {
  it('GET does NOT change state — it renders a POST confirm form', async () => {
    const res = await GET(new NextRequest(url('?token=tok123')))
    const body = await res.text()
    expect(memberUpdate).not.toHaveBeenCalled()
    expect(body).toContain('<form method="POST"')
    expect(body).toContain('name="token"')
  })

  it('POST flips marketing_consent to false', async () => {
    const res = await POST(new NextRequest(url('?token=tok123'), { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(memberUpdate).toHaveBeenCalledTimes(1)
    expect(memberUpdate.mock.calls[0][0]).toMatchObject({ marketing_consent: false })
  })

  it('escapes the echoed member email in the confirmation page', async () => {
    memberRow = { id: 'm1', email: '<b>x</b>@evil.test' }
    const res = await POST(new NextRequest(url('?token=tok123'), { method: 'POST' }))
    const body = await res.text()
    expect(body).not.toContain('<b>x</b>@evil.test')
    expect(body).toContain('&lt;b&gt;x&lt;/b&gt;@evil.test')
  })
})
