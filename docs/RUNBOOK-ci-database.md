# Runbook: the CI database (`db` job)

Multi-tenancy plan, Stage 1: "Ephemeral CI database (`supabase start` plus
pgTAP) as a parallel job. Diff the schema against a production schema-only
dump."

The `db` job in `.github/workflows/ci.yml` builds a throwaway Postgres on the
GitHub runner, loads the schema of record, applies every migration since it, and
runs pgTAP tests against the result. It never connects to the dev or production
Supabase projects and holds no database credential.

## What it does

| Step | What happens |
|---|---|
| Scope | A PR that touches neither `supabase/` nor `ci.yml` cannot change the database, so the job ends green in seconds. Pushes to `dev`/`main` and manual runs always build. |
| Start | `supabase db start` (CLI pinned in the job's `SUPABASE_CLI_VERSION`, which also pins the Postgres image). Postgres only, not the full stack. The CLI's own migration replay and seed are switched off for this step with `SUPABASE_DB_MIGRATIONS_ENABLED=false` and `SUPABASE_DB_SEED_ENABLED=false`, because `001`–`148` cannot rebuild the schema (see `docs/SCHEMA-BASELINE.md`). |
| Baseline | `supabase/baseline.sql` is loaded the documented way (drop `entitlements` and `public`, load with `ON_ERROR_STOP=1`). Three kinds of line are removed first: `\restrict`/`\unrestrict`, and the `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` lines the `postgres` role cannot run. |
| Migrations | Every timestamped file in `supabase/migrations/` (14-digit prefix), oldest first, each in its own transaction. The first failure names the file and stops the job. |
| pgTAP | `supabase test db supabase/tests/database`. |
| Schema diff | Runs only when the `PROD_SCHEMA_DUMP` secret is set; otherwise it prints a notice. Report-only. |

Expected time: about 2–4 minutes, mostly image pulls (Postgres, Auth and
Storage; Realtime is switched off). The images are not cached: saving and
restoring about 1 GB of images through `actions/cache` is unlikely to beat a
pull from Supabase's registry, and the PR scope step already skips most runs.

## The pgTAP tests

`supabase/tests/database/security.test.sql` (47 assertions):

- No SECURITY DEFINER function in `public` or `entitlements` is executable by
  `anon`.
- `authenticated` can execute only the allow-listed RLS helpers:
  `can_read_space`, `can_read_chat_channel`, `survey_current_member_id`, and
  `space_unread_counts` (S0-9, still open).
- Every table in `public` and `entitlements` has RLS enabled.
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

## Making it a required check

The job is report-only at first: `continue-on-error` is on unless the repository
variable `DB_CI_ENFORCE` is `true`. A failure shows red on the PR but does not
fail the workflow.

1. Wait for a green run on a PR that touches `supabase/` (or run the workflow by
   hand).
2. Settings → Secrets and variables → Actions → Variables: add
   `DB_CI_ENFORCE` = `true`.
3. Add `db` to the required status checks in the `dev` and `main` rulesets.

If the first run fails at the baseline or a migration, that is the finding this
job exists for: the repository cannot rebuild production. Fix the baseline or
the migration (never edit an applied migration; add a new one) before step 2.

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
   Delete the local files afterwards.
4. Refresh the secret whenever a migration is applied to production.

The step accepts xz, gzip or plain SQL, base64-encoded. It loads the dump into a
scratch database in the same Postgres (with the extensions it uses and stubs of
`auth.jwt()`/`auth.uid()`), dumps both databases with the same `pg_dump`, and
diffs them. `-` lines exist only in production; `+` lines only in the
repository. Drift marks the step with a warning and puts the diff in the job
summary; it does not fail the job.

The diff appears in CI logs, which are public for this repository. That reveals
no more than `supabase/baseline.sql` already does (the same kind of schema-only
dump), but take a fresh dump and read it before setting the secret.

Fork PRs get no secrets, so they skip the diff with a notice.

If the dump outgrows 48 KB, use GitHub's documented pattern for large secrets:
commit a `gpg --symmetric` encrypted file and keep only the passphrase as a
secret. That needs a small change to the step.
