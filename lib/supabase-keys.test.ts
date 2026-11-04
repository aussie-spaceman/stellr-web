import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SupabaseKeySlotError,
  supabaseApiHeaders,
  supabaseFetch,
  supabaseKeyKind,
  supabaseKeyRole,
  supabaseKeySlots,
  supabasePublicKey,
  supabaseSecretKey,
} from './supabase-keys'

// S0 key migration: Supabase retires the JWT anon/service_role keys at the end
// of 2026. These pin that the app reads the new publishable/secret variables
// only (the legacy-name fallback was removed 3 Nov 2026, runbook step 11, so a
// legacy-only env is unconfigured), never needs a key to be a JWT, still
// catches a mis-slotted legacy JWT value, and never sends a new-format key as a
// Bearer token.

// Obviously fake values, short enough that no secret scanner mistakes them.
const PUBLISHABLE = 'sb_publishable_TESTONLY'
const SECRET = 'sb_secret_TESTONLY'
// Fake legacy keys, built at run time so no JWT-shaped literal sits in the
// repo: real JWT structure and role claim, a signature that verifies nothing.
const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`
const LEGACY_ANON = fakeLegacyKey('anon')
const LEGACY_SERVICE = fakeLegacyKey('service_role')

const VARS = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

beforeEach(() => {
  for (const name of VARS) vi.stubEnv(name, undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('supabaseKeyKind', () => {
  it('tells the formats apart by prefix and shape alone', () => {
    expect(supabaseKeyKind(PUBLISHABLE)).toBe('publishable')
    expect(supabaseKeyKind(SECRET)).toBe('secret')
    expect(supabaseKeyKind(LEGACY_ANON)).toBe('legacy-jwt')
    expect(supabaseKeyKind(LEGACY_SERVICE)).toBe('legacy-jwt')
  })

  it('calls anything else unrecognised, including CI placeholders', () => {
    expect(supabaseKeyKind('placeholder-secret-key')).toBe('unrecognised')
    expect(supabaseKeyKind('sb_temp_abc')).toBe('unrecognised')
    expect(supabaseKeyKind('abc.def.ghi')).toBe('unrecognised')
    expect(supabaseKeyKind('eyJonly.two')).toBe('unrecognised')
  })
})

describe('supabaseKeyRole', () => {
  it('maps the new formats to the role they carry', () => {
    expect(supabaseKeyRole(PUBLISHABLE)).toBe('anon')
    expect(supabaseKeyRole(SECRET)).toBe('service_role')
  })

  it("reads a legacy key's role claim (detection only, no verification)", () => {
    expect(supabaseKeyRole(LEGACY_ANON)).toBe('anon')
    expect(supabaseKeyRole(LEGACY_SERVICE)).toBe('service_role')
  })

  it('is null when the role cannot be told, and never throws', () => {
    expect(supabaseKeyRole('eyJhbGci.eyJyb2xl.c2VydmljZQ')).toBeNull() // payload is not valid JSON
    expect(supabaseKeyRole(`${b64url('{"alg":"HS256"}')}.${b64url('{"iss":"x"}')}.TESTONLY`)).toBeNull()
    expect(supabaseKeyRole('placeholder-secret-key')).toBeNull()
    expect(supabaseKeyRole('sb_temp_abc')).toBeNull()
  })
})

describe('supabasePublicKey', () => {
  it('reads the publishable key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    expect(supabasePublicKey()).toBe(PUBLISHABLE)
  })

  it('no longer reads the legacy anon variable, in any format', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    expect(supabasePublicKey()).toBeUndefined()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', PUBLISHABLE)
    expect(supabasePublicKey()).toBeUndefined()
  })

  it('ignores the legacy anon variable when the publishable key is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_SERVICE)
    expect(supabasePublicKey()).toBe(PUBLISHABLE)
  })

  it('treats an empty or blank variable as unset (GitHub Actions sends "" for a missing secret)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '  ')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    expect(supabasePublicKey()).toBeUndefined()
  })

  it('still accepts a legacy anon JWT value under the new name (format-agnostic)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', LEGACY_ANON)
    expect(supabasePublicKey()).toBe(LEGACY_ANON)
  })

  it('trims a pasted trailing newline', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', `${PUBLISHABLE}\n`)
    expect(supabasePublicKey()).toBe(PUBLISHABLE)
  })

  it('is undefined when the variable is unset', () => {
    expect(supabasePublicKey()).toBeUndefined()
  })

  it('refuses a secret key in the public slot, naming the variable but not the value', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', SECRET)
    expect(() => supabasePublicKey()).toThrow(SupabaseKeySlotError)
    expect(() => supabasePublicKey()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a Supabase secret key/)
    try {
      supabasePublicKey()
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET)
    }
  })

  it('ignores a secret key under the legacy public name (that variable is not read)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', SECRET)
    expect(supabasePublicKey()).toBeUndefined()
  })

  it('refuses a legacy service_role JWT in the public slot, without echoing it', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', LEGACY_SERVICE)
    expect(() => supabasePublicKey()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a Supabase legacy service_role key/)
    try {
      supabasePublicKey()
    } catch (e) {
      expect((e as Error).message).not.toContain(LEGACY_SERVICE)
    }
  })
})

describe('supabaseSecretKey', () => {
  it('reads the secret key, ignoring the legacy service_role variable', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_ANON)
    expect(supabaseSecretKey()).toBe(SECRET)
  })

  it('no longer reads the legacy service_role variable, unset or empty new name alike', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)
    expect(supabaseSecretKey()).toBeUndefined()
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    expect(supabaseSecretKey()).toBeUndefined()
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SECRET)
    expect(supabaseSecretKey()).toBeUndefined()
  })

  it('still accepts a legacy service_role JWT value under the new name (format-agnostic)', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', LEGACY_SERVICE)
    expect(supabaseSecretKey()).toBe(LEGACY_SERVICE)
  })

  it('is undefined when the variable is unset', () => {
    expect(supabaseSecretKey()).toBeUndefined()
  })

  it('refuses the publishable key in the secret slot (it would run as anon, not bypass RLS)', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', PUBLISHABLE)
    expect(() => supabaseSecretKey()).toThrow(SupabaseKeySlotError)
    expect(() => supabaseSecretKey()).toThrow(/SUPABASE_SECRET_KEY holds a Supabase publishable key/)
  })

  it('refuses a legacy anon JWT in the secret slot (the same silent-anon failure)', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', LEGACY_ANON)
    expect(() => supabaseSecretKey()).toThrow(/SUPABASE_SECRET_KEY holds a Supabase legacy anon key/)
  })

  it('still accepts a legacy key whose role cannot be read (no new failure for an odd JWT)', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'eyJhbGci.eyJyb2xl.c2VydmljZQ')
    expect(supabaseSecretKey()).toBe('eyJhbGci.eyJyb2xl.c2VydmljZQ')
  })
})

describe('supabaseApiHeaders (raw fetch to the Supabase API)', () => {
  it('sends a legacy JWT on apikey and Authorization, as before', () => {
    expect(supabaseApiHeaders(LEGACY_SERVICE)).toEqual({ apikey: LEGACY_SERVICE, Authorization: `Bearer ${LEGACY_SERVICE}` })
  })

  it('never sends a secret key as a Bearer token', () => {
    expect(supabaseApiHeaders(SECRET)).toEqual({ apikey: SECRET })
  })

  it('never sends a publishable key as a Bearer token', () => {
    expect(supabaseApiHeaders(PUBLISHABLE)).toEqual({ apikey: PUBLISHABLE })
  })

  it('keeps anything that is not a JWT off Authorization', () => {
    expect(supabaseApiHeaders('sb_future_kind_x')).toEqual({ apikey: 'sb_future_kind_x' })
  })
})

describe('supabaseFetch (the fetch every supabase-js client here is given)', () => {
  let seen: { input: unknown; init?: RequestInit }[]
  beforeEach(() => {
    seen = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      seen.push({ input, init })
      return new Response(null, { status: 204 })
    }))
  })
  const sentHeaders = () => new Headers(seen[0].init?.headers)

  it.each([['publishable', PUBLISHABLE], ['secret', SECRET]])(
    'drops the %s key that supabase-js repeats on Authorization, keeping apikey',
    async (_kind, key) => {
      await supabaseFetch('https://example.supabase.co/rest/v1/x', {
        method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'X-Client-Info': 'test' },
      })
      expect(sentHeaders().get('apikey')).toBe(key)
      expect(sentHeaders().get('Authorization')).toBeNull()
      expect(sentHeaders().get('X-Client-Info')).toBe('test')
      expect(seen[0].init?.method).toBe('GET')
    },
  )

  it('keeps the URL, method, body and other headers of a write when it drops the header', async () => {
    await supabaseFetch('https://example.supabase.co/rest/v1/x', {
      method: 'POST',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, Prefer: 'return=minimal' },
      body: '{"id":1}',
    })
    expect(seen[0].input).toBe('https://example.supabase.co/rest/v1/x')
    expect(seen[0].init).toMatchObject({ method: 'POST', body: '{"id":1}' })
    expect(sentHeaders().get('Prefer')).toBe('return=minimal')
    expect(sentHeaders().get('Authorization')).toBeNull()
  })

  it('does the same when supabase-js hands over a Headers object', async () => {
    await supabaseFetch('https://example.supabase.co/rest/v1/x', {
      headers: new Headers({ apikey: SECRET, authorization: `Bearer ${SECRET}` }),
    })
    expect(sentHeaders().get('Authorization')).toBeNull()
  })

  it('leaves a user token (Clerk) on Authorization untouched', async () => {
    await supabaseFetch('https://example.supabase.co/rest/v1/x', {
      headers: { apikey: PUBLISHABLE, Authorization: 'Bearer eyJclerk.eyJzZXNzaW9u.dG9rZW4' },
    })
    expect(sentHeaders().get('Authorization')).toBe('Bearer eyJclerk.eyJzZXNzaW9u.dG9rZW4')
  })

  it('leaves a legacy JWT key on both headers, exactly as before', async () => {
    const init = { headers: { apikey: LEGACY_SERVICE, Authorization: `Bearer ${LEGACY_SERVICE}` } }
    await supabaseFetch('https://example.supabase.co/rest/v1/x', init)
    expect(seen[0].init).toBe(init)
  })

  it('passes a call without headers straight through', async () => {
    await supabaseFetch('https://example.supabase.co/rest/v1/x')
    expect(seen[0]).toEqual({ input: 'https://example.supabase.co/rest/v1/x', init: undefined })
  })
})

describe('supabaseKeySlots', () => {
  it('reports kind, role and source variable for each slot, never a value', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    const slots = supabaseKeySlots()
    expect(slots).toEqual({
      public: { variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', kind: 'publishable', role: 'anon' },
      secret: { variable: 'SUPABASE_SECRET_KEY', kind: 'secret', role: 'service_role' },
    })
    const json = JSON.stringify(slots)
    expect(json).not.toContain(PUBLISHABLE)
    expect(json).not.toContain(SECRET)
  })

  it('says unconfigured when a slot is empty', () => {
    expect(supabaseKeySlots()).toEqual({
      public: { variable: null, kind: 'unconfigured', role: null },
      secret: { variable: null, kind: 'unconfigured', role: null },
    })
  })

  it('says unconfigured for a legacy-only env (the legacy names are no longer read)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)
    expect(supabaseKeySlots()).toEqual({
      public: { variable: null, kind: 'unconfigured', role: null },
      secret: { variable: null, kind: 'unconfigured', role: null },
    })
  })

  it('reports a mis-slotted key instead of throwing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', SECRET)
    vi.stubEnv('SUPABASE_SECRET_KEY', PUBLISHABLE)
    expect(supabaseKeySlots()).toEqual({
      public: { variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', kind: 'secret', role: 'service_role' },
      secret: { variable: 'SUPABASE_SECRET_KEY', kind: 'publishable', role: 'anon' },
    })
  })

  it('tells swapped legacy JWT values apart by role (both are legacy-jwt)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', LEGACY_SERVICE)
    vi.stubEnv('SUPABASE_SECRET_KEY', LEGACY_ANON)
    expect(supabaseKeySlots()).toEqual({
      public: { variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', kind: 'legacy-jwt', role: 'service_role' },
      secret: { variable: 'SUPABASE_SECRET_KEY', kind: 'legacy-jwt', role: 'anon' },
    })
  })
})
