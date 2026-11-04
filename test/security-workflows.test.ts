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

  it('checks the lockfile with a checker that does not come from that lockfile, before installing it', () => {
    const job = security.slice(security.indexOf('  supply-chain:'), security.indexOf('  migration-report:'))
    // Not the devDependency from node_modules: a PR edits package-lock.json,
    // so it could point lockfile-lint itself at a tarball that always passes.
    expect(job).not.toContain('npm run lint:lockfile')
    expect(job).not.toMatch(/node_modules\/\.bin\/lockfile-lint/)
    const lint = /npx --yes lockfile-lint@(\d+\.\d+\.\d+)/.exec(job)
    expect(lint).not.toBeNull()
    // Runs outside the checkout (no repo lockfile or .npmrc), with its own
    // dependency tree frozen to a date.
    const step = job.slice(job.lastIndexOf('- name:', lint!.index), lint!.index)
    expect(step).toContain('working-directory: ${{ runner.temp }}')
    expect(step).toMatch(/NPM_CONFIG_BEFORE: '\d{4}-\d{2}-\d{2}'/)
    // Before npm ci, which installs anything at all from the lockfile.
    expect(lint!.index).toBeLessThan(job.indexOf('npm ci --ignore-scripts'))
    expect(job).toContain('npm audit signatures')
    expect(job).not.toContain('continue-on-error')
  })

  it('runs lockfile-lint in CI with exactly the flags and version of `npm run lint:lockfile`', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const flags = (cmd: string) => cmd.replace(/--path\s+\S+/, '').replace(/\s+/g, ' ').trim()
    const local = flags(pkg.scripts['lint:lockfile'].replace(/^lockfile-lint\s+/, ''))
    const job = security.slice(security.indexOf('  supply-chain:'), security.indexOf('  migration-report:'))
    const ci = /npx --yes lockfile-lint@(\S+)\s+([\s\S]*?)\n\s*\n/.exec(job)!
    expect(ci[1]).toBe(pkg.devDependencies['lockfile-lint'])
    expect(flags(ci[2])).toBe(local)
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

describe('Stryker runner support gate', () => {
  it('knows vitest-runner 10.0.0 does not activate mutants under Vitest 5, and 10.1.0 does', async () => {
    const { runnerSupportsVitest, versionLessThan } = await import('../scripts/stryker-runner-support.mjs')
    // Probed 4 Nov 2026: 10.0.0 + Vitest 5.0.5 killed 0 of 42 mutants.
    expect(runnerSupportsVitest('10.0.0', '5.0.5')).toBe(false)
    expect(runnerSupportsVitest('10.1.0', '5.0.5')).toBe(true)
    expect(runnerSupportsVitest('10.1.1', '5.2.0')).toBe(true)
    expect(runnerSupportsVitest('11.0.0', '5.0.5')).toBe(true)
    expect(runnerSupportsVitest('10.0.0', '4.1.2')).toBe(true)
    expect(versionLessThan('10.0.9', '10.1.0')).toBe(true)
    expect(versionLessThan('10.10.0', '10.9.0')).toBe(false)
  })

  it('skips the nightly run on an unsupported pair instead of failing it, and still fails a supported run that kills nothing', () => {
    const steps = mutation.slice(mutation.indexOf('\n    steps:'))
    expect(steps).toContain('node scripts/stryker-runner-support.mjs')
    expect(steps.indexOf('id: support')).toBeLessThan(steps.indexOf('npx stryker run'))
    const stryker = steps.slice(steps.indexOf('- name: Stryker'), steps.indexOf('- name: Score'))
    expect(stryker).toContain("if: steps.support.outputs.supported == 'true'")
    const score = steps.slice(steps.indexOf('- name: Score'))
    expect(score).toContain("if: always() && steps.support.outputs.supported == 'true'")
    expect(score).toContain('killed === 0')
    expect(steps).toMatch(/::warning::\$msg/)
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
