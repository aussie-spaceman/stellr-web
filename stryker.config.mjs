// Stryker mutation testing (multi-tenant plan, S2 assurance harness).
//
// A mutation run changes the code under test one small edit at a time (flip a
// comparison, drop a condition, return early) and re-runs the tests. A mutant
// that no test notices ("survived") is a line the tests do not really pin —
// on authorisation and crypto code, that is a gap someone can walk through.
//
// Scope: trust-boundary modules only. Add tenancy (lib/tenancy/**), field
// crypto (lib/field-crypto.ts) and the ledger here as S3/S4/S9 land them.
//
// Runs nightly and on demand (.github/workflows/mutation.yml), never on pull
// requests: a full run takes tens of minutes. Report-only for now
// (thresholds.break is null); once a baseline score is recorded, set `break`
// just under it so the score can only go up.
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
  ],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
  timeoutMS: 15000,
}

export default config
