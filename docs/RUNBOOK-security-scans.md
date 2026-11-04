# Runbook: security scans, mutation testing, migration reports

Multi-tenant plan, Stage 2 (assurance harness). Every tool here is free. None
of it touches the dev or production projects, and none of it holds a secret.

## What runs where

| Check | Where | Blocking? | Turn it into a gate |
|---|---|---|---|
| Semgrep CE, repo rules in `.semgrep/` | `security.yml` → `semgrep` | No | Repo variable `SEMGREP_ENFORCE=true`, then make `semgrep` a required check |
| OSV-Scanner on `package-lock.json` | `security.yml` → `osv-scanner` | No (4 advisories open in transitive dev/build deps) | Clear them, then `OSV_ENFORCE=true` |
| gitleaks on the commits a PR or push adds | `security.yml` → `gitleaks` | No (not yet run in CI) | After a green run, `GITLEAKS_ENFORCE=true` |
| lockfile-lint + `npm audit signatures` | `security.yml` → `supply-chain` | Yes (both passed when added) | Add `supply-chain` to the required checks |
| Migration report with RED FLAGS | `security.yml` → `migration-report` (PRs touching `supabase/migrations`) | Never: summary + warning | — |
| Stryker mutation testing | `mutation.yml`, nightly 03:17 UTC and by hand | Never, but fails if no mutant is killed | Set `thresholds.break` in `stryker.config.mjs` |

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
without WHERE, GRANT to anon/authenticated/PUBLIC, SECURITY DEFINER, RLS
disabled or not forced, a policy that is always true for a non-service role,
anything in the auth or storage schema). The same SQL always gives the same
flags. A flag means "read this statement", not "this is wrong": dropping and
re-creating a policy is routine. `scripts/fixtures/migration-report/` holds a
seeded dangerous migration that must trip every flag.

## Mutation testing

`npm run test:mutation` (or `npx stryker run --mutate lib/impersonation.ts`).
Reports land in `reports/mutation/` (gitignored). Add tenancy, field-crypto and
ledger modules to `mutate` in `stryker.config.mjs` as those stages land.

Instrumented code runs 20-130x slower. When `STRYKER_MUTATOR_WORKER` is set,
`lib/pdf-page-count.test.ts` stops asserting its wall-clock budgets and skips
its linear-time suites, and Vitest's test timeout is 180 s
(`vitest.config.mts`). Normal runs are unchanged.

## Pins and bumps

Actions are pinned to commit SHAs and containers to image digests, each with
its tag in a comment. To bump, resolve the new tag to its SHA or digest and
replace both. New npm dev dependencies use exact versions published at least
14 days earlier: `npm install --save-dev --save-exact --before=<date> <pkg>@<ver>`.
