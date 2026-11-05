# Runbook: the CI database (`db` job)

Multi-tenancy plan, Stage 1: "Ephemeral CI database (`supabase start` plus
pgTAP) as a parallel job. Diff the schema against a production schema-only
dump."

The `db` job in `.github/workflows/ci.yml` builds a throwaway Postgres on the
GitHub runner, loads the schema of record, applies every migration since it, and
runs pgTAP tests against the result. It never connects to the dev or production
Supabase projects and holds no database credential.

**Status (3 Nov 2026): written, never run.** Neither the authoring nor the
reviewing machine had Docker or a Postgres server, so the baseline load, the
migration replay and the pgTAP file have not been executed anywhere. The job is
report-only (below), so the CI workflow can be green while `db` is red. Until the
first run is read step by step, a green badge says nothing about this job. See
"First run" below.

## What it does

| Step | What happens |
|---|---|
| Scope | A PR that touches neither `supabase/` nor `ci.yml` cannot change the database, so the job ends green in seconds. Pushes to `dev`/`main` and manual runs always build. |
| Start | `supabase db start` (CLI pinned in the job's `SUPABASE_CLI_VERSION`, which also pins the Postgres image). Postgres only, not the full stack. The CLI's own migration replay and seed are switched off for this step with `SUPABASE_DB_MIGRATIONS_ENABLED=false` and `SUPABASE_DB_SEED_ENABLED=false`, because `001`–`148` cannot rebuild the schema (see `docs/SCHEMA-BASELINE.md`). |
| Baseline | `supabase/baseline.sql` is loaded the documented way (drop `entitlements` and `public`, load with `ON_ERROR_STOP=1`). Three kinds of line are removed first: `\restrict`/`\unrestrict`, and the `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` lines the `postgres` role cannot run. |
| Migrations | Every timestamped file in `supabase/migrations/` (14-digit prefix), oldest first, each in its own transaction. The first failure names the file and stops the job. |
| pgTAP | `supabase test db supabase/tests/database`. |
| Schema diff | Pushes to `dev`/`main` and manual runs only, never pull requests. Runs only when the `PROD_SCHEMA_DUMP` secret is set; otherwise it prints a notice. Publishes object names and counts, never SQL. Report-only. |

Time: **not measured yet.** The estimate is 2–4 minutes, mostly image pulls
(Postgres, plus the Auth and Storage images the CLI runs once to create their
schemas; Realtime is switched off). Record the real time of the first runs here.

Caching is a deliberate choice, not an omission. Nothing is cached today:

- The PR scope step already makes most PR runs take seconds.
- The CLI download is one small release binary.
- Saving and restoring about 1 GB of images through `actions/cache` (a
  `docker save`/`docker load` pair keyed on `SUPABASE_CLI_VERSION`) is not
  clearly faster than a registry pull. It would also use about a tenth of the
  repository's 10 GB cache, shared with the npm and Next.js caches.

Revisit this once there are measured timings. If the pulls dominate a run of
more than 3 minutes, add the `docker save`/`docker load` cache and compare.

## The pgTAP tests

`supabase/tests/database/security.test.sql` (52 assertions):

- No SECURITY DEFINER function in `public` or `entitlements` is executable by
  `anon`.
- `authenticated` can execute only the allow-listed RLS helpers:
  `can_read_space`, `can_read_chat_channel`, `survey_current_member_id`, and
  `space_unread_counts` (S0-9, still open).
- Every table in `public` and `entitlements` has RLS enabled.
- Every view that `anon` or `authenticated` can read is `security_invoker`. A
  view without it runs with its owner's rights and ignores the base tables' RLS.
  The schema's default privileges give both roles ALL on every new relation in
  `public`, views included, so write new views as
  `CREATE VIEW public.x WITH (security_invoker = true) AS ...`.
- `anon` and `authenticated` cannot read any materialized view or foreign
  table. Neither kind can have RLS. Revoke SELECT from both roles on any you
  create.
- Self-tests: the file plants a table without RLS, an owner-rights view, an
  invoker view and a readable materialized view, all rolled back. It then checks
  that each relation check reports exactly the bad object, which proves the
  checks can fail.
- The 14 functions sealed by `20261102220634_seal_definer_functions_db_n3`:
  `anon` cannot execute any of them; `authenticated` can execute only
  `survey_current_member_id`; `service_role` can execute all of them.
- Two guards so an empty database cannot pass: at least 100 tables and at least
  20 definer functions.

This is the pgTAP twin of `supabase/tests/security_checks.sql`, the read-only
query run by hand on dev and prod. When the allow-list changes, change it in
both files and in `FROZEN_RLS_HELPERS` in `scripts/check-migration-security.mjs`.

Add new tests as `supabase/tests/database/<name>.test.sql`. Always pass the
directory to `supabase test db`: the other files in `supabase/tests/` are
manual SQL-editor checks, not pgTAP, and `pg_prove` fails on them.

## Running it locally

Needs Docker (or a compatible runtime) and the Supabase CLI.

```bash
SUPABASE_DB_MIGRATIONS_ENABLED=false SUPABASE_DB_SEED_ENABLED=false \
  SUPABASE_REALTIME_ENABLED=false npx supabase db start
# then the "Load the baseline schema" and "Apply migrations" steps from ci.yml
npx supabase test db supabase/tests/database
npx supabase stop --no-backup
```

Do not run `supabase start` or `supabase db reset` with the defaults: both
replay `001`–`148`, which fails at `001`.

## First run, then making it a required check

The job is report-only at first: `continue-on-error` is on unless the repository
variable `DB_CI_ENFORCE` is `true`. A failure shows red on the `db` job but does
not fail the workflow, so the workflow badge is no evidence either way.

1. Run the workflow by hand (Actions → CI → Run workflow, on `dev`), or let a PR
   that touches `supabase/` run it. Open the `db` job and read every step's
   outcome. "Start the local database", "Load the baseline schema", "Apply
   migrations since the baseline" and "pgTAP tests" must each be green. The
   pgTAP log must end with `All tests successful` and `Tests=52`. A skipped step
   does not count.
2. Record the job's duration in "What it does" above, and the date of the first
   green run in the status line at the top.
3. Settings → Secrets and variables → Actions → Variables: add
   `DB_CI_ENFORCE` = `true`.
4. Add `db` to the required status checks in the `dev` and `main` rulesets.

If the first run fails at the baseline or a migration, that is the finding this
job exists for: the repository cannot rebuild production. Fix the baseline or
the migration (never edit an applied migration; add a new one) before step 3.

## The e2e-local job

`e2e-local` in `.github/workflows/ci.yml` runs the Playwright suite against a
Supabase stack on the runner instead of the shared dev project, with no
`e2e-dev-supabase` lock. It holds no Supabase secret.

**Status: report-only, and not yet proven.** It is not a required check, and a
failure does not fail the workflow. `e2e` remains the gate. A green badge says
nothing about this job: read its steps and its summary.

### How it is built

| Step | What happens |
|---|---|
| Start | `supabase start` with migrations and seed off. Postgres, Kong, PostgREST, Storage and Auth; everything else is excluded. The app doesn't use Auth, but `supabase status` doesn't report the API keys without it. |
| Point | Reads the URL and keys from `supabase status`, and stops if the URL is not on loopback. |
| Database | `scripts/e2e-stack-db.sh`: baseline, migrations, `supabase/seed.sql`, `supabase/seed-e2e-stack.sql`. Then exposes `entitlements` on the `authenticator` role. It can't go in `config.toml`: PostgREST would report unhealthy until the schema exists, and `supabase start` would stop the stack. |
| Wait | Reads `public.members` and `entitlements.tiers` through the gateway until PostgREST has the schema. |
| Seed | `npm run seed:e2e-stack`: blank agreement documents with the real field maps, survey definitions, and Clerk links looked up by address. Refuses anything but loopback and `sk_test_`. |
| Suite | `npm run build`, then `npx playwright test`. Storybook and Lighthouse stay in `e2e`: neither reads the database. |

Clerk is still the shared dev instance. Only the database moved.

### What it does not test

- **The hosted dev project:** a missing bucket, an unexposed schema or a migration
  not applied to dev will not show here. `e2e` still covers this.
- **The real agreement documents:** the fixtures are blank pages, so wording and
  placement stay with `scripts/esign-template.ts check`.
- **Realtime:** not started, and no spec needs it.
- **Certificate artwork:** none is stored, so certificates print the plain design.

### Removing the lock (owner)

The lock can go only when all of these hold. Record the evidence here.

1. About 10 PR runs where `e2e-local` and `e2e` agree on every test. Compare the
   skipped lists as well as the failures: the job's summary lists its skips.
2. Two `e2e-local` runs overlapping with no failures, which proves concurrent
   sign-ins as the same Clerk users. Clerk's rate limits are the unknown.
3. Real start-up times recorded in this section.

Then move this job's contents under the required `e2e` name, delete the
`concurrency` block and the dev Supabase secrets from it, and keep a manual or
nightly run against dev so drift there is still seen.

## The schema diff against production

CI never connects to production. The owner takes a schema-only dump and gives it
to CI as a secret.

1. Take the dump with the same command that refreshes the baseline (libpq 18,
   session-pooler URI; see `docs/SCHEMA-BASELINE.md`):

   ```bash
   /opt/homebrew/opt/libpq/bin/pg_dump "<prod-session-pooler-URI>" -W \
     --schema=public --schema=entitlements \
     --schema-only --no-owner -f prod-schema.sql
   ```

   With Docker available, `npx supabase db dump --db-url "<prod URI>" -s public,entitlements -f prod-schema.sql`
   is equivalent (`supabase db dump` dumps the schema only unless given
   `--data-only`).
2. Compress and encode it. Repository secrets are limited to 48 KB; with xz the
   November 2026 schema comes to about 43 KB of base64, so check the size:

   ```bash
   xz -9e -c prod-schema.sql | base64 > prod-schema.b64
   wc -c prod-schema.b64   # must be under 49152
   ```

3. Settings → Secrets and variables → Actions → Secrets: set `PROD_SCHEMA_DUMP`
   to the contents of `prod-schema.b64` (`gh secret set PROD_SCHEMA_DUMP < prod-schema.b64`).
4. Refresh the secret whenever a migration is applied to production.

The step accepts xz, gzip or plain SQL, base64-encoded. It loads the dump into a
scratch database in the same Postgres (with the extensions it uses and stubs of
`auth.jwt()`/`auth.uid()`), dumps both databases with the same `pg_dump`, and
compares them object by object, using `pg_dump`'s own `-- Name:` headers.

### What reaches the public log

CI logs and job summaries are public for this repository. Drift is, by
definition, production SQL that was never reviewed here. That includes functions
written in the SQL editor, policies, comments, column defaults and trigger
arguments, and a Database Webhook's trigger carries its `Authorization` header.
So the step publishes only:

- the identifiers of objects that are only in production, only in the
  repository, or defined differently (`FUNCTION public.foo(uuid)`,
  `POLICY public.members members_select`, and so on), up to 200 of each;
- the counts, and the first 16 hex digits of a sha256 of each normalised object
  list, so two runs can be compared.

If the production dump fails to load, the step reports only the dump's line
number. psql's own message quotes the failing statement, so it stays in a file
on the runner.

The step never runs on `pull_request`. A pull request runs its own copy of
`ci.yml`, so skipping that event keeps PR-head code away from
`PROD_SCHEMA_DUMP`. The step runs on pushes to `dev`/`main` and on manual runs.
A collaborator who can push a branch could still edit the workflow and run it
by hand. That is the same trust model as every other secret in this workflow.
For stricter isolation, move the step into its own job bound to a protected
environment that holds the secret.

Fork PRs get no secrets either way.

### Reading the full diff (owner, locally)

The CI summary says which objects differ; read their SQL on your own machine.
Without Docker, compare against dev, which is built from the same migrations:

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "<dev-session-pooler-URI>" -W \
  --schema=public --schema=entitlements --schema-only --no-owner -f dev-schema.sql
diff -u prod-schema.sql dev-schema.sql | less
```

With Docker, use the exact repository schema: run the job's steps locally (see
"Running it locally"), load `prod-schema.sql` into a `prod_ref` database the way
the step does, and `diff -u` the two `pg_dump --schema-only --no-owner` outputs.

Delete `prod-schema.sql`, `prod-schema.b64` and `dev-schema.sql` afterwards.

If the dump outgrows 48 KB, use GitHub's documented pattern for large secrets:
commit a `gpg --symmetric` encrypted file and keep only the passphrase as a
secret. That needs a small change to the step.
