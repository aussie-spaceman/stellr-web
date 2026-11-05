// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PRODUCTION_SUPABASE_REF } from './two-tenant-seed'
import { assertE2eSupabase, DEV_SUPABASE_REF, isAllowedE2eSupabase, isLoopbackSupabase } from './e2e-supabase-target'

const DEV = `https://${DEV_SUPABASE_REF}.supabase.co`
const PROD = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`
const LOCAL = 'http://127.0.0.1:54321'

describe('e2e Supabase target', () => {
  it('allows the dev project and a stack on this machine', () => {
    for (const url of [DEV, LOCAL, 'http://localhost:54321', 'http://[::1]:54321']) {
      expect(isAllowedE2eSupabase(url), url).toBe(true)
    }
  })

  it('refuses production', () => {
    expect(isAllowedE2eSupabase(PROD)).toBe(false)
    expect(() => assertE2eSupabase(PROD)).toThrow(/neither/)
  })

  it('refuses a URL that only mentions an allowed name', () => {
    for (const url of [
      `https://evil.example/?x=${DEV_SUPABASE_REF}.supabase.co`,
      `https://${DEV_SUPABASE_REF}.supabase.co.evil.example`,
      `https://evil.example/${DEV_SUPABASE_REF}`,
      'https://127.0.0.1.evil.example',
      'https://localhost.evil.example',
    ]) {
      expect(isAllowedE2eSupabase(url), url).toBe(false)
    }
  })

  it('refuses a missing or malformed value', () => {
    for (const url of [undefined, null, '', 'not a url']) {
      expect(isAllowedE2eSupabase(url)).toBe(false)
      expect(() => assertE2eSupabase(url ?? '')).toThrow(/neither/)
    }
  })

  it('counts only loopback as disposable, never the shared dev project', () => {
    expect(isLoopbackSupabase(LOCAL)).toBe(true)
    expect(isLoopbackSupabase(DEV)).toBe(false)
    expect(isLoopbackSupabase(PROD)).toBe(false)
  })
})
