// Stryker mutation testing (multi-tenant plan, S2 assurance harness).
//
// A mutation run changes the code under test one small edit at a time (flip a
// comparison, drop a condition, return early) and re-runs the tests. A mutant
// that no test notices ("survived") is a line the tests do not really pin —
// on authorisation and crypto code, that is a gap someone can walk through.
//
// Scope: trust-boundary modules only: authorisation, impersonation, tenancy
// (the scoped loader, the tenant client in lib/tenancy/db.ts), field crypto
// (lib/field-crypto*.ts) and the platform audit trail (lib/audit/platform.ts).
// Add the ledger here when S9 lands it.
//
// Runs nightly and on demand (.github/workflows/mutation.yml), never on pull
// requests: a full run takes tens of minutes. thresholds.break is 80: a run
// whose overall score falls below 80% fails the job (S2-stryker). Do not lower
// it to turn a run green; kill the surviving mutants with better tests.
//
//   npx stryker run                                  # everything below
//   npx stryker run --mutate lib/esign/backup-crypto.ts
//
// Reports: reports/mutation/index.html and reports/mutation/mutation.json.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: {
    configFile: 'vitest.config.mts',
    // Only the tests that import a mutated file (directly or transitively)
    // run for it, not the whole suite.
    related: true,
  },
  mutate: [
    'lib/access-gates.ts',
    'lib/impersonation.ts',
    'lib/esign/backup-crypto.ts',
    'lib/pdf-scan.ts',
    'lib/authz.ts',
    'lib/authz/decide.ts',
    'lib/authz/principal.ts',
    'lib/tenancy/load-scoped.ts',
    'lib/tenancy/scope-context.ts',
    'lib/tenancy/db.ts',
    'lib/field-crypto*.ts',
    '!lib/field-crypto*.test.ts',
    'lib/audit/platform.ts',
  ],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: 80 },
  // In place, not in a .stryker-tmp sandbox: in the sandbox node_modules is a
  // symlink, and Vite then resolves a test's relative import into
  // node_modules (test/csp-script-nonces.test.tsx loads Clerk's script-tag
  // module by path) to '/node_modules/…', which fails the initial test run.
  // Stryker keeps the originals in tempDirName and puts them back when done;
  // if a local run is killed, the next run restores them first. The backups
  // include rewritten test files, so vitest.config.mts excludes .stryker-tmp.
  inPlace: true,
  // The initial run executes every test related to the mutated files; on a
  // 4-vCPU runner that can pass the 5-minute default.
  dryRunTimeoutMinutes: 30,
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
  timeoutMS: 15000,
}

export default config
