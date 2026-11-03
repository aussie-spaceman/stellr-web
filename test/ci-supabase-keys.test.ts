// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// S0 key migration, step 11 (3 Nov 2026): the app reads only the new variable
// names, so both CI jobs set only those. The e2e job fills them from the new
// repository secrets alone; a `||` fallback to the legacy anon/service_role
// secrets would hand the app keys that Supabase has disabled. The verify job
// builds with placeholders under the new names, and its bundle check proves the
// public one ships and the secret one does not.
describe('ci.yml Supabase keys (S0)', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const verify = ci.slice(ci.indexOf('\n  verify:\n'), ci.indexOf('\n  e2e:\n'))
  const e2e = ci.slice(ci.indexOf('\n  e2e:\n'))

  it('finds both jobs', () => {
    expect(verify).toContain('npm run build')
    expect(e2e).toContain('npx playwright test')
  })

  it('maps only the new secrets, with no legacy fallback (e2e)', () => {
    expect(e2e).toMatch(/^\s*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.DEV_SUPABASE_PUBLISHABLE_KEY \}\}$/m)
    expect(e2e).toMatch(/^\s*SUPABASE_SECRET_KEY: \$\{\{ secrets\.DEV_SUPABASE_SECRET_KEY \}\}$/m)
    expect(ci).not.toContain('DEV_SUPABASE_ANON_KEY')
    expect(ci).not.toContain('DEV_SUPABASE_SERVICE_ROLE_KEY')
  })

  it('fails the e2e config check on the new names', () => {
    expect(e2e).toMatch(/for name in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY \\/)
  })

  it('sets the legacy variable names in neither job', () => {
    expect(ci).not.toMatch(/^\s*NEXT_PUBLIC_SUPABASE_ANON_KEY:/m)
    expect(ci).not.toMatch(/^\s*SUPABASE_SERVICE_ROLE_KEY:/m)
  })

  it('builds with placeholders under the new names in verify', () => {
    expect(verify).toMatch(/^\s*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: placeholder-publishable-key$/m)
    expect(verify).toMatch(/^\s*SUPABASE_SECRET_KEY: placeholder-secret-key$/m)
  })

  it('checks after that build that the public key reached the browser bundle and the secret key did not', () => {
    const build = verify.indexOf('run: npm run build')
    const check = verify.indexOf('- name: Supabase keys in the browser bundle')
    expect(build).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(build)
    expect(verify.slice(check)).toContain('grep -rqF placeholder-publishable-key .next/static')
    expect(verify.slice(check)).toContain('if grep -rqF placeholder-secret-key .next/static; then')
  })
})
