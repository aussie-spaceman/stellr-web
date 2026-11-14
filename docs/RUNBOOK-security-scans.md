# Runbook: security scans, mutation testing, migration reports

Multi-tenant plan, Stage 2 (assurance harness). Every tool here is free. None
of it touches the dev or production projects, and none of it holds a secret.

## What runs where

| Check | Where | Blocking? | Turn it into a gate |
|---|---|---|---|
| Semgrep CE, repo rules in `.semgrep/` | `security.yml` → `semgrep` | No | Repo variable `SEMGREP_ENFORCE=true`, then make `semgrep` a required check |
| OSV-Scanner on `package-lock.json` | `security.yml` → `osv-scanner` | No. One advisory accepted, with a reason and an expiry, in `osv-scanner.toml` | The owner sets `OSV_ENFORCE=true` once a run passes |
| gitleaks on the commits a PR or push adds | `security.yml` → `gitleaks` | No (not yet run in CI) | After a green run, `GITLEAKS_ENFORCE=true` |
| lockfile-lint + `npm audit signatures` | `security.yml` → `supply-chain` | Yes (both passed when added) | Add `supply-chain` to the required checks |

CI runs lockfile-lint as `npx --yes lockfile-lint@5.1.0` in the runner's temp
directory, before `npm ci`, with `NPM_CONFIG_BEFORE` fixing its dependency tree
to a date. It must not be the devDependency: a PR that edits
`package-lock.json` decides where that copy comes from, so it could install a
checker that always passes. To bump it, change the version (and the date) in
`security.yml` and in `package.json` together; a test checks they match.
| Migration report with RED FLAGS | `security.yml` → `migration-report` (PRs touching `supabase/migrations`) | Never: summary + warning | — |
| Stryker mutation testing | `mutation.yml`, nightly 03:17 UTC and by hand | Never blocks a PR. The nightly job fails when the overall score is under 80% (`thresholds.break` in `stryker.config.mjs`) or when no mutant is killed | Done: Stryker 10.1.1, `thresholds.break: 80`. Do not lower it; add tests |

A report-only job still shows red on the PR; it cannot fail the workflow.
Repo variables live at Settings → Secrets and variables → Actions → Variables.

## Semgrep rules

| Rule | Severity | Catches |
|---|---|---|
| `stellr-service-role-outside-allowlist` | ERROR | `supabaseServer` / `supabaseServerTyped` imported outside `app/`, `lib/`, `scripts/`, `e2e/`, `test/`, `supabase/` and one grandfathered server component |
| `stellr-service-role-in-client-module` | ERROR | the same import in any `'use client'` module |
| `stellr-dangerously-set-inner-html` | ERROR | raw HTML sinks outside `components/seo/JsonLd.tsx` and the constant-only consent script |
| `stellr-unscoped-event-table` | WARNING | a query on an event-scoped table with no `event_slug` / `event_id` filter: the S5 tenancy worklist (236 when added) |

Only ERROR rules gate. Each rule file has a test in `.semgrep/tests/` with the
same name; `sh scripts/semgrep-rule-tests.sh` runs them, and CI fails on a rule
file without one.

Locally (Semgrep is a Python tool, not an npm dependency):

```sh
python3 -m venv ~/.venvs/semgrep && ~/.venvs/semgrep/bin/pip install semgrep
PATH="$HOME/.venvs/semgrep/bin:$PATH" npm run lint:semgrep
```

A deliberate exception goes in the rule's `paths.exclude` with a comment that
says why, never as a blanket `nosemgrep`.

## Migration report

```sh
npm run migration:report                       # migrations changed vs origin/dev
npm run migration:report -- path/to/file.sql   # named files
```

The RED FLAGS are pattern rules (DROP, DROP COLUMN, TRUNCATE, DELETE or UPDATE
without a top-level WHERE, also inside or after a WITH CTE, GRANT to
anon/authenticated/PUBLIC, SECURITY DEFINER, RLS disabled or not forced, role
attributes and ownership changes, a policy that is always true for a
non-service role, ALTER POLICY widened to anon/authenticated/PUBLIC, anything
in the auth or storage schema, including through `SET search_path`, and every
EXECUTE of dynamic SQL). The literal parts of an EXECUTE's SQL are checked
against the same rules; SQL held in a variable cannot be, which is why the
EXECUTE itself is always flagged. The same SQL always gives the same flags. A flag means "read this statement", not "this is wrong": dropping and
re-creating a policy is routine. `scripts/fixtures/migration-report/` holds a
seeded dangerous migration that must trip every flag.

## Mutation testing

`npm run test:mutation` (or `npx stryker run --mutate lib/impersonation.ts`).

`@stryker-mutator/core` and `@stryker-mutator/vitest-runner` are pinned at
10.1.1. The earlier 10.0.0 runner did not activate mutants under Vitest 5:
every test showed "(covered 0)" and nothing was killed. They were bumped with:

```sh
npm install --save-dev --save-exact --before=2026-10-24 @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1
```

`mutation.yml` still checks the pair first (`scripts/stryker-runner-support.mjs`)
and skips the run with a warning if a later change brings back a runner older
than 10.1.0 under Vitest 5. A supported run that kills no mutant fails.

`thresholds.break` is 80: a run whose overall score is under 80% fails the
nightly job. The Score step still writes the per-file table to the job summary.
If the score drops, kill the surviving mutants with better tests; do not lower
the threshold.

The first full run on 10.1.1 (14 Nov 2026, 232 minutes on the 4-vCPU runner)
scored 73.3% (3925 of 5352 mutants killed), so the nightly job fails until
the tests reach 80%. The weakest files: `lib/field-crypto-fields.ts` (16.5%),
`lib/field-crypto-store.ts` (19.6%), `lib/access-gates.ts` (51.7%),
`lib/esign/backup-crypto.ts` (60.0%), `lib/audit/platform.ts` (64.6%) and
`lib/pdf-scan.ts` (67.5%; the most survivors, 400). The Score step's table in
the job summary has every file. The job's timeout is 360 minutes, the
GitHub-hosted maximum. If runs come close to it, split `mutate` across a
matrix rather than cutting files.

Stryker runs in place (`inPlace: true`), not in a `.stryker-tmp` sandbox: in
the sandbox `node_modules` is a symlink, and a test that imports a module by a
relative path into `node_modules` failed the initial test run. In place, it
backs up every file it rewrites under `.stryker-tmp/backup-*` and puts them
back at the end. If a local run is killed, the next run restores them first;
check `git status` before committing. `vitest.config.mts` excludes
`.stryker-tmp/**` so the backed-up test files never run.

Reports land in `reports/mutation/` (gitignored). `mutate` in
`stryker.config.mjs` covers authorisation, impersonation, the tenancy loader
and tenant client (`lib/tenancy/db.ts`), field crypto (`lib/field-crypto*.ts`,
tests excluded) and the platform audit trail (`lib/audit/platform.ts`). Add the
ledger when S9 lands it.

Instrumented code runs 20-130x slower. When `STRYKER_MUTATOR_WORKER` is set,
`lib/pdf-page-count.test.ts` stops asserting its wall-clock budgets and skips
its linear-time suites, and Vitest's test timeout is 180 s
(`vitest.config.mts`). Normal runs are unchanged.

## Pins and bumps

Actions are pinned to commit SHAs and containers to image digests, each with
its tag in a comment. To bump, resolve the new tag to its SHA or digest and
replace both. New npm dev dependencies use exact versions published at least
14 days earlier: `npm install --save-dev --save-exact --before=<date> <pkg>@<ver>`.
