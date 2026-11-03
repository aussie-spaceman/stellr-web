// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// S0 key migration: CI hands the app the new variable names, filled from the
// new repository secrets when they exist and from the legacy anon/service_role
// secrets until those are deleted. Pin both halves, so deleting the legacy
// secrets (docs/RUNBOOK-supabase-api-keys.md) cannot silently empty a slot.
describe('ci.yml Supabase keys (S0)', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

  it('maps the new secrets first, the legacy ones as fallback', () => {
    expect(ci).toContain(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.DEV_SUPABASE_PUBLISHABLE_KEY || secrets.DEV_SUPABASE_ANON_KEY }}',
    )
    expect(ci).toContain(
      'SUPABASE_SECRET_KEY: ${{ secrets.DEV_SUPABASE_SECRET_KEY || secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}',
    )
  })

  it('fails the e2e config check on the new names', () => {
    expect(ci).toMatch(/for name in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY \\/)
  })

  it('no longer sets the legacy variable names', () => {
    expect(ci).not.toMatch(/^\s*NEXT_PUBLIC_SUPABASE_ANON_KEY:/m)
    expect(ci).not.toMatch(/^\s*SUPABASE_SERVICE_ROLE_KEY:/m)
  })
})
