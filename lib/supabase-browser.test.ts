import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserSupabase, createStorageUploadClient } from './supabase-browser'

// S0 key migration: the browser clients take the publishable key (or the legacy
// anon key while it exists). The publishable key is not a JWT, so it must never
// go out on Authorization: that header carries the Clerk session token or
// nothing. These run real supabase-js requests against a stubbed fetch and read
// the headers that went out.

// Fake legacy keys, built at run time so no JWT-shaped literal sits in the repo.
const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`

const PUBLISHABLE = 'sb_publishable_TESTONLY'
const LEGACY_ANON = fakeLegacyKey('anon')
const CLERK_TOKEN = 'eyJclerk.eyJzZXNzaW9u.dG9rZW4'

let sent: { url: string; headers: Headers }[]

beforeEach(() => {
  sent = []
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const restCall = () => sent.find((r) => r.url.includes('/rest/v1/'))

describe('createBrowserSupabase (Realtime chat)', () => {
  it('sends the publishable key on apikey and the Clerk session token on Authorization', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    const sb = createBrowserSupabase(async () => CLERK_TOKEN)
    await sb.from('community_posts').select('id')
    expect(restCall()?.headers.get('apikey')).toBe(PUBLISHABLE)
    expect(restCall()?.headers.get('Authorization')).toBe(`Bearer ${CLERK_TOKEN}`)
  })

  it('sends no Authorization at all when there is no Clerk token, rather than the publishable key', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    const sb = createBrowserSupabase(async () => null)
    await sb.from('community_posts').select('id')
    expect(restCall()?.headers.get('apikey')).toBe(PUBLISHABLE)
    expect(restCall()?.headers.get('Authorization')).toBeNull()
  })

  it('falls back to the legacy anon key while the publishable variable is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    const sb = createBrowserSupabase(async () => CLERK_TOKEN)
    await sb.from('community_posts').select('id')
    expect(restCall()?.headers.get('apikey')).toBe(LEGACY_ANON)
    expect(restCall()?.headers.get('Authorization')).toBe(`Bearer ${CLERK_TOKEN}`)
  })

  it('sends the legacy anon key on Authorization as before when signed out (today\'s config)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    const sb = createBrowserSupabase(async () => null)
    await sb.from('community_posts').select('id')
    expect(restCall()?.headers.get('apikey')).toBe(LEGACY_ANON)
    expect(restCall()?.headers.get('Authorization')).toBe(`Bearer ${LEGACY_ANON}`)
  })

  it('refuses to start with a secret key in the public slot', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_TESTONLY')
    expect(() => createBrowserSupabase(async () => CLERK_TOKEN)).toThrow(/secret key/)
  })

  it('refuses to start with a legacy service_role key in the public slot', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', fakeLegacyKey('service_role'))
    expect(() => createBrowserSupabase(async () => CLERK_TOKEN)).toThrow(/legacy service_role key/)
  })

  it('throws when no public key is configured', () => {
    expect(() => createBrowserSupabase(async () => null)).toThrow(/not configured/)
  })
})

describe('createStorageUploadClient (signed upload)', () => {
  const upload = async () => {
    await createStorageUploadClient().storage.from('uploads').uploadToSignedUrl('a/b.txt', 'signed-token', new Blob(['x']))
    const put = sent.find((r) => r.url.includes('/storage/v1/'))
    expect(put).toBeDefined()
    return put!
  }

  it('sends the publishable key on apikey only, never as a Bearer token', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    const put = await upload()
    expect(put.headers.get('apikey')).toBe(PUBLISHABLE)
    expect(put.headers.get('Authorization')).toBeNull()
    // The signed URL's own token travels in the query string, untouched.
    expect(put.url).toContain('token=signed-token')
  })

  it('works with only the legacy anon name set (today), sending it on both headers as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    const put = await upload()
    expect(put.headers.get('apikey')).toBe(LEGACY_ANON)
    expect(put.headers.get('Authorization')).toBe(`Bearer ${LEGACY_ANON}`)
  })
})
