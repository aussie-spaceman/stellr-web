// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S0 key migration: the owner checks here which key format the deployment
// actually holds. `vercel env pull`
// redacts secrets, so only the deployment can say. Kinds, roles and variable
// names only: a key value must never appear in the response.

const authMock = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))

import { GET } from './route'

const PUBLISHABLE = 'sb_publishable_TESTONLY'
const SECRET = 'sb_secret_TESTONLY'
// Fake legacy keys, built at run time so no JWT-shaped literal sits in the repo.
const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`
const LEGACY_ANON = fakeLegacyKey('anon')
const LEGACY_SERVICE = fakeLegacyKey('service_role')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)
  vi.stubEnv('SUPABASE_SECRET_KEY', undefined)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  authMock.mockReset()
})

describe('GET /api/admin/health/integrations — supabaseKeys', () => {
  it('reports each slot as kind + role + variable, never the value', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)

    const res = await GET()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text).supabaseKeys).toEqual({
      public: { variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', kind: 'publishable', role: 'anon' },
      secret: { variable: 'SUPABASE_SECRET_KEY', kind: 'secret', role: 'service_role' },
    })
    for (const value of [PUBLISHABLE, SECRET, LEGACY_SERVICE]) expect(text).not.toContain(value)
  })

  // Since runbook step 11 (3 Nov 2026) the legacy names are not read, so a
  // deployment that only has them shows both slots unconfigured.
  it('shows a legacy-only deployment as unconfigured, never echoing the values', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)

    const text = await (await GET()).text()
    expect(JSON.parse(text).supabaseKeys).toEqual({
      public: { variable: null, kind: 'unconfigured', role: null },
      secret: { variable: null, kind: 'unconfigured', role: null },
    })
    for (const value of [LEGACY_ANON, LEGACY_SERVICE]) expect(text).not.toContain(value)
  })

  it('stays admin-only (403 for a member)', async () => {
    authMock.mockResolvedValue({ userId: 'u-member', sessionClaims: { metadata: { role: 'member' } } })
    expect((await GET()).status).toBe(403)
  })
})
