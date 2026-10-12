// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// deep review TEST-5: the e2e check is a REQUIRED gate on dev and main. It used
// to finish green when a repository secret was missing (every later step
// skipped), so the required check passed WITHOUT e2e having run. The config step
// must now fail closed — exit non-zero on a missing secret, unless a repo
// variable explicitly opts a secret-less environment (e.g. a fork) out. Pin that
// so the fail-closed branch cannot be silently removed again.
describe('ci.yml e2e fail-closed (TEST-5)', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

  it('exits non-zero when e2e secrets are missing', () => {
    expect(ci).toMatch(/ALLOW_UNCONFIGURED/)
    expect(ci).toMatch(/if \[ "\$ALLOW_UNCONFIGURED" != "true" \]; then/)
    expect(ci).toMatch(/exit 1/)
  })
})
