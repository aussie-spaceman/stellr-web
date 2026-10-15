import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Signature checking is next-sanity's job; these tests pin what the route does
// with its answer.
vi.mock('next-sanity/webhook', () => ({ parseBody: vi.fn() }))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import { POST } from './route'
import { parseBody } from 'next-sanity/webhook'
import { revalidateTag } from 'next/cache'

const parse = vi.mocked(parseBody)
const call = () => POST(new Request('https://www.test/api/webhooks/sanity', { method: 'POST' }) as unknown as NextRequest)

describe('/api/webhooks/sanity', () => {
  beforeEach(() => {
    vi.stubEnv('SANITY_REVALIDATE_SECRET', 'shh')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('expires every Sanity read on a signed call', async () => {
    parse.mockResolvedValue({ isValidSignature: true, body: { _type: 'event' } as never })
    const res = await call()
    expect(res.status).toBe(200)
    expect(parse).toHaveBeenCalledWith(expect.anything(), 'shh', true)
    expect(revalidateTag).toHaveBeenCalledWith('sanity', { expire: 0 })
  })

  it('401s and revalidates nothing on a bad signature', async () => {
    parse.mockResolvedValue({ isValidSignature: false, body: null })
    expect((await call()).status).toBe(401)
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('refuses every call until the secret is set', async () => {
    vi.stubEnv('SANITY_REVALIDATE_SECRET', '')
    expect((await call()).status).toBe(500)
    expect(parse).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('400s on a body it cannot read', async () => {
    parse.mockRejectedValue(new SyntaxError('bad json'))
    expect((await call()).status).toBe(400)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
