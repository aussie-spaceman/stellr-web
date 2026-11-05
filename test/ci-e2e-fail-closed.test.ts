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

  // GitHub's default keeps one pending job per group and cancels the rest: 7 of
  // 59 jobs asking for this lock on 4-5 Nov 2026 were lost that way.
  it('queues e2e jobs behind the lock rather than dropping them', () => {
    expect(ci).toMatch(
      /group: e2e-dev-supabase\n\s+cancel-in-progress: false\n\s+queue: max\n/,
    )
  })

  // Anything that stops a queued suite from running reads as cancelled, not
  // failed. The gate has to treat every result but success as red.
  it('the gate passes only when the suite succeeded', () => {
    expect(ci).toMatch(/if \[ "\$TESTS" != success \] \|\| \[ "\$STORYBOOK" != success \]; then/)
  })
})
