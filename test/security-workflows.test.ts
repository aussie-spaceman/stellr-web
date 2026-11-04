// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// S2 supply chain: pin the shape of the security and mutation workflows so a
// later edit cannot quietly unpin an action, put mutation testing on every PR,
// or make a report-only job blocking without the repo variable.

const security = readFileSync('.github/workflows/security.yml', 'utf8')
const mutation = readFileSync('.github/workflows/mutation.yml', 'utf8')

describe('security.yml and mutation.yml', () => {
  it.each([
    ['security.yml', security],
    ['mutation.yml', mutation],
  ])('%s pins every action to a full commit SHA', (_name, yml) => {
    const uses = [...yml.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/)
  })

  it('pins every container image by digest', () => {
    const images = [...security.matchAll(/(?:image:|IMAGE:)\s*(\S+)/g)].map((m) => m[1])
    expect(images.length).toBe(3)
    for (const i of images) expect(i).toMatch(/@sha256:[0-9a-f]{64}$/)
  })

  it('keeps the report-only jobs behind their enforce variables', () => {
    for (const v of ['SEMGREP_ENFORCE', 'OSV_ENFORCE', 'GITLEAKS_ENFORCE']) {
      expect(security).toContain(`continue-on-error: \${{ vars.${v} != 'true' }}`)
    }
  })

  it('gates Semgrep on ERROR rules only, and runs the rule tests', () => {
    expect(security).toContain('--severity ERROR --error')
    expect(security).toContain('sh scripts/semgrep-rule-tests.sh')
  })

  it('checks the lockfile before any package code can run', () => {
    const job = security.slice(security.indexOf('  supply-chain:'), security.indexOf('  migration-report:'))
    expect(job).toContain('npm ci --ignore-scripts')
    expect(job.indexOf('npm ci --ignore-scripts')).toBeLessThan(job.indexOf('npm run lint:lockfile'))
    expect(job).toContain('npm audit signatures')
    expect(job).not.toContain('continue-on-error')
  })

  it('runs mutation testing on a schedule or by hand, never on pull requests or pushes', () => {
    const on = mutation.slice(mutation.indexOf('\non:'), mutation.indexOf('\nconcurrency:'))
    expect(on).toContain('schedule:')
    expect(on).toContain('workflow_dispatch:')
    expect(on).not.toMatch(/pull_request|push:/)
  })
})

describe('Semgrep rules', () => {
  it('has a rule test for every rule file', () => {
    const rules = readdirSync('.semgrep').filter((f) => f.endsWith('.yml'))
    expect(rules.length).toBeGreaterThanOrEqual(4)
    for (const r of rules) {
      const name = r.replace(/\.yml$/, '')
      expect(existsSync(`.semgrep/tests/${name}.ts`) || existsSync(`.semgrep/tests/${name}.tsx`)).toBe(true)
    }
  })

  it('keeps the rule tests out of real scans', () => {
    expect(readFileSync('.semgrepignore', 'utf8')).toMatch(/^\.semgrep\/tests\/$/m)
  })
})

describe('Stryker scope', () => {
  it('mutates the trust-boundary modules', async () => {
    const { default: config } = await import('../stryker.config.mjs')
    expect(config.mutate).toEqual(
      expect.arrayContaining(['lib/access-gates.ts', 'lib/impersonation.ts', 'lib/esign/backup-crypto.ts', 'lib/pdf-scan.ts']),
    )
    expect(config.testRunner).toBe('vitest')
  })
})
