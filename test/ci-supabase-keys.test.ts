// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// S0 key migration. The e2e job hands the app the new variable names, filled
// from the new repository secrets when they exist and from the legacy
// anon/service_role secrets until those are deleted. Pin both halves, so
// deleting the legacy secrets (docs/RUNBOOK-supabase-api-keys.md) cannot
// silently empty a slot. The verify job builds with the legacy names only, as
// both Vercel projects are set today, so CI covers the fallback path too.
describe('ci.yml Supabase keys (S0)', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const verify = ci.slice(ci.indexOf('\n  verify:\n'), ci.indexOf('\n  e2e:\n'))
  const e2e = ci.slice(ci.indexOf('\n  e2e:\n'))

  it('finds both jobs', () => {
    expect(verify).toContain('npm run build')
    expect(e2e).toContain('npx playwright test')
  })

  it('maps the new secrets first, the legacy ones as fallback (e2e)', () => {
    expect(e2e).toContain(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.DEV_SUPABASE_PUBLISHABLE_KEY || secrets.DEV_SUPABASE_ANON_KEY }}',
    )
    expect(e2e).toContain(
      'SUPABASE_SECRET_KEY: ${{ secrets.DEV_SUPABASE_SECRET_KEY || secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}',
    )
  })

  it('fails the e2e config check on the new names', () => {
    expect(e2e).toMatch(/for name in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY \\/)
  })

  it('does not set the legacy variable names in e2e', () => {
    expect(e2e).not.toMatch(/^\s*NEXT_PUBLIC_SUPABASE_ANON_KEY:/m)
    expect(e2e).not.toMatch(/^\s*SUPABASE_SERVICE_ROLE_KEY:/m)
  })

  it('builds with only the legacy names in verify (today on both Vercel projects)', () => {
    expect(verify).toMatch(/^\s*NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key$/m)
    expect(verify).toMatch(/^\s*SUPABASE_SERVICE_ROLE_KEY: placeholder-service-role-key$/m)
    expect(verify).not.toMatch(/^\s*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:/m)
    expect(verify).not.toMatch(/^\s*SUPABASE_SECRET_KEY:/m)
  })

  it('checks after that build that the public key reached the browser bundle and the server key did not', () => {
    const build = verify.indexOf('run: npm run build')
    const check = verify.indexOf('- name: Supabase keys in the browser bundle')
    expect(build).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(build)
    expect(verify.slice(check)).toContain('grep -rqF placeholder-anon-key .next/static')
    expect(verify.slice(check)).toContain('if grep -rqF placeholder-service-role-key .next/static; then')
  })
})
