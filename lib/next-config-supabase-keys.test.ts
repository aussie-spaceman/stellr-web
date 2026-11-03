import { describe, expect, it } from 'vitest'
import { secretInPublicSupabaseKey } from '../next.config.mjs'

// S0 key migration: next.config.mjs refuses to build when a Supabase secret key
// sits in a NEXT_PUBLIC_ variable, because Next copies those into the browser
// bundle. The likeliest moment is the owner pasting new keys into Vercel.

// Fake legacy keys, built at run time so no JWT-shaped literal sits in the repo.
const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`

describe('secretInPublicSupabaseKey', () => {
  it('names the public variable that holds a secret key', () => {
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_TESTONLY' }))
      .toBe('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: ' sb_secret_TESTONLY\n' }))
      .toBe('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('names the public variable that holds the legacy service_role key', () => {
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeLegacyKey('service_role') }))
      .toBe('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `${fakeLegacyKey('service_role')}\n` }))
      .toBe('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  })

  it('lets publishable, legacy anon and placeholder keys through', () => {
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TESTONLY' })).toBeNull()
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeLegacyKey('anon') })).toBeNull()
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGci.eyJyb2xl.YW5vbg' })).toBeNull()
    expect(secretInPublicSupabaseKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'placeholder-publishable-key' })).toBeNull()
    expect(secretInPublicSupabaseKey({})).toBeNull()
  })

  it('ignores a secret key in the server-only variables', () => {
    expect(secretInPublicSupabaseKey({ SUPABASE_SECRET_KEY: 'sb_secret_TESTONLY' })).toBeNull()
    expect(secretInPublicSupabaseKey({ SUPABASE_SERVICE_ROLE_KEY: fakeLegacyKey('service_role') })).toBeNull()
  })
})
