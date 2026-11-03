import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { supabase, supabaseServer, supabaseServerTyped } from './supabase'

// deep review QUAL-4: supabaseServerTyped() applies the Database generic so
// column/enum drift is a compile error on the tables the generic covers.
describe('supabaseServerTyped (QUAL-4)', () => {
  it('is exported', () => {
    expect(typeof supabaseServerTyped).toBe('function')
  })
})

// Fake legacy keys, built at run time so no JWT-shaped literal sits in the
// repo: real JWT structure, a role claim, and a signature that verifies nothing.
const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`

// S0 key migration: the server clients take the secret key (or the legacy
// service_role key while it exists) through lib/supabase-keys.ts. These run a
// real supabase-js query against a stubbed fetch and read what went out.
describe('server client keys (S0)', () => {
  const SECRET = 'sb_secret_TESTONLY'
  const LEGACY_SERVICE = fakeLegacyKey('service_role')
  let sent: Headers[]

  beforeEach(() => {
    sent = []
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', undefined)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      sent.push(new Headers(init?.headers))
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each([
    ['supabaseServer', supabaseServer],
    ['supabaseServerTyped', supabaseServerTyped],
  ])('%s sends the new secret key on apikey only, never as a Bearer token', async (_name, make) => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)
    await make().from('registrations').select('id')
    expect(sent).toHaveLength(1)
    expect(sent[0].get('apikey')).toBe(SECRET)
    expect(sent[0].get('Authorization')).toBeNull()
  })

  it.each([
    ['supabaseServer', supabaseServer],
    ['supabaseServerTyped', supabaseServerTyped],
  ])('%s falls back to the legacy service_role key, on both headers as before, when only the legacy name is set', async (_name, make) => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)
    await make().from('registrations').select('id')
    expect(sent[0].get('apikey')).toBe(LEGACY_SERVICE)
    expect(sent[0].get('Authorization')).toBe(`Bearer ${LEGACY_SERVICE}`)
  })

  it('keeps a secret key off Authorization on Storage calls too', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    await supabaseServer().storage.from('uploads').createSignedUploadUrl('a/b.txt')
    const storage = sent.at(-1)!
    expect(storage.get('apikey')).toBe(SECRET)
    expect(storage.get('Authorization')).toBeNull()
  })

  it('names both variables when neither is set', () => {
    expect(() => supabaseServer()).toThrow(/SUPABASE_SECRET_KEY \(or legacy SUPABASE_SERVICE_ROLE_KEY\)/)
  })

  it('refuses a publishable key in the secret slot before any request', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_publishable_TESTONLY')
    expect(() => supabaseServer()).toThrow(/publishable/)
    expect(sent).toHaveLength(0)
  })

  it('refuses a legacy anon key in the secret slot before any request', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', fakeLegacyKey('anon'))
    expect(() => supabaseServer()).toThrow(/SUPABASE_SECRET_KEY holds a Supabase legacy anon key/)
    expect(sent).toHaveLength(0)
  })
})

// The public server-side client (supabase()): publishable key, or the legacy
// anon key while only the legacy name is set (today's Vercel config).
describe('public client keys (S0)', () => {
  const PUBLISHABLE = 'sb_publishable_TESTONLY'
  const LEGACY_ANON = fakeLegacyKey('anon')
  let sent: Headers[]

  beforeEach(() => {
    sent = []
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      sent.push(new Headers(init?.headers))
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends the publishable key on apikey only, never as a Bearer token', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    await supabase().from('events').select('id')
    expect(sent[0].get('apikey')).toBe(PUBLISHABLE)
    expect(sent[0].get('Authorization')).toBeNull()
  })

  it('works with only the legacy anon name set, sending it on both headers as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    await supabase().from('events').select('id')
    expect(sent[0].get('apikey')).toBe(LEGACY_ANON)
    expect(sent[0].get('Authorization')).toBe(`Bearer ${LEGACY_ANON}`)
  })

  it('refuses a legacy service_role key in the public slot', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', fakeLegacyKey('service_role'))
    expect(() => supabase()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY holds a Supabase legacy service_role key/)
  })

  it('names both variables when neither is set', () => {
    expect(() => supabase()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \(or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY\)/)
  })
})

// Compile-time only — never executed. The @ts-expect-error directives below are
// checked by `tsc --noEmit` (part of the gate): if the client were NOT typed by
// the Database generic, the writes would be accepted, the directives would be
// "unused", and tsc would fail. So this doubles as a regression guard that the
// generic stays applied — new drift (a wrong enum value, a column that does not
// exist) is caught before runtime.
async function _qual4DriftIsCaught(db: ReturnType<typeof supabaseServerTyped>) {
  // A real table + column compiles.
  await db.from('registrations').select('id')
  // @ts-expect-error QUAL-4: a value outside the status union is rejected.
  await db.from('registrations').update({ status: 'not_a_status' }).eq('id', 'x')
  // @ts-expect-error QUAL-4: a write to a column that does not exist is rejected.
  await db.from('registrations').update({ no_such_column: 1 }).eq('id', 'x')
}
void _qual4DriftIsCaught
